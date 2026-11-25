// A reporter for node:test that prints a row for each test file, with its
// project, as Vitest's default reporter does:
//
//     node --test --test-reporter=hypotes/reporter
//
//      ✓ |@acme/a| test/sum.test.ts (3 tests | 1 skipped) 2ms
//
// A file's project is the nearest package with a name, from `project.ts`.
// The errors of failed tests come after the files, and then the totals.
//
// node:test reports a file's tests together, and files in order, under each
// `--test-isolation`. So a file's row is printed once another file's tests
// start, or the run ends. It reports a summary of a file too, but only from a
// process of the file's own, and not for a file that failed to load, so the
// counts here are of the tests' own events, counted as node:test counts
// them, but for the test that it reports in place of a file.
//
// An event's `file` is where its test was declared, which is another module
// if a helper declared it, as a rule tester does. Its `entryFile` is the
// test file, which the rows are of. node:test sets it only for a file that
// runs in a process of its own, so with `--test-isolation=none` such a test
// goes under the module that declared it. Node 24.13.1 doesn't set it at
// all, so there such a test goes under that module in a process of its own
// too.
//
// In a job of GitHub Actions, the failures follow the totals once more, each
// as a workflow command, and the run's summary goes to the job's, as
// `github-actions.ts` says. A failure is at the innermost frame of its
// error's stack in the project's own code, as Vitest's is, or else where its
// test was declared, which is where a file that failed to load starts.
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { spec, type TestEvent } from 'node:test/reporters';
import { inspect, stripVTControlCharacters, styleText } from 'node:util';
import {
    formatErrorCommand,
    GitHubActions,
    type Annotation
} from './github-actions.ts';
import { Projects, type Project } from './project.ts';
import { parseStack, type Position } from './stack.ts';

type TestStart = Extract<TestEvent, { type: 'test:start' }>;
type TestPass = Extract<TestEvent, { type: 'test:pass' }>;
type TestFail = Extract<TestEvent, { type: 'test:fail' }>;
type TestResult = TestFail | TestPass;

/**
 * Whether Node prints colours, as it does to a terminal or with FORCE_COLOR:
 * `styleText` leaves its text as it is where it doesn't
 */
const COLORS = styleText('red', 'text') !== 'text';

/** The backgrounds of projects' names, one of which a name picks */
const PROJECT_COLORS = ['bgYellow', 'bgCyan', 'bgGreen', 'bgMagenta'] as const;

/**
 * The diagnostics in which node:test reports the run's totals, which the
 * totals here replace
 */
const TOTAL =
    /^(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) [\d.]+$/;

/** The mark of a failure's error, which is a block of colour where it has one */
const FAIL = COLORS ? styleText(['bold', 'inverse', 'red'], ' FAIL ') : ' FAIL';

/** How many tests had each result. A suite isn't a test. */
class Counts {
    failed = 0;
    passed = 0;
    skipped = 0;
    todo = 0;

    total(): number {
        return this.failed + this.passed + this.skipped + this.todo;
    }

    /** Counts a test as node:test does: one to do isn't failed, if it fails */
    add({ type, data }: TestResult): void {
        if (isSet(data.skip)) {
            this.skipped++;
        } else if (isSet(data.todo)) {
            this.todo++;
        } else if (type === 'test:fail') {
            this.failed++;
        } else {
            this.passed++;
        }
    }

    /** Adds the counts of a file's tests to a run's */
    addAll(counts: Counts): void {
        this.failed += counts.failed;
        this.passed += counts.passed;
        this.skipped += counts.skipped;
        this.todo += counts.todo;
    }

    /** Each count but zeroes, as `1 failed | 2 passed`, and then the total */
    format(): string {
        const parts = [
            this.failed > 0
                ? styleText(['bold', 'red'], `${this.failed} failed`)
                : '',
            this.passed > 0
                ? styleText(['bold', 'green'], `${this.passed} passed`)
                : '',
            this.skipped > 0
                ? styleText('yellow', `${this.skipped} skipped`)
                : '',
            this.todo > 0 ? styleText('gray', `${this.todo} todo`) : ''
        ].filter(part => part !== '');

        const total = styleText('gray', `(${this.total()})`);

        return parts.length === 0 ? total : `${parts.join(' | ')} ${total}`;
    }
}

/** A test, a suite's hook, or a file that failed */
interface Failure {
    /** Whether a test failed, rather than a suite or the file itself */
    readonly isTest: boolean;
    /** The names of its suites and its own. None, if it's the file itself. */
    readonly titles: readonly string[];
    readonly duration: number;
    readonly error: string;
    /** What it failed with: what a test threw, or node:test's reason */
    readonly cause: unknown;
    /** Where it was declared */
    readonly declared: Position;
}

/** Why node:test failed a test, which its error says, as `subtestsFailed` */
function failureType(error: Error): unknown {
    return (error as { failureType?: unknown }).failureType;
}

/** Whether a test's `skip` or `todo` is true, or gives a reason */
function isSet(flag: boolean | string | undefined): boolean {
    return flag != null && flag !== false;
}

function formatDuration(milliseconds: number): string {
    return `${Math.round(milliseconds)}ms`;
}

/**
 * The name of a project, on a background that the name picks, or between
 * bars without colours, as Vitest prints it
 */
function formatProject({ name }: Project): string {
    if (!COLORS) {
        return `|${name}|`;
    }

    let sum = 0;
    for (let index = 0; index < name.length; index++) {
        sum += name.charCodeAt(index) + index;
    }

    return styleText(
        [PROJECT_COLORS[sum % PROJECT_COLORS.length], 'black'],
        ` ${name} `
    );
}

/** What a test failed with, as node:test's reporters print it */
function formatError(cause: unknown): string {
    return typeof cause === 'string'
        ? cause
        : inspect(cause, { colors: COLORS });
}

/** The stack of what a test threw, if it has one, as an error does */
function stackOf(cause: unknown): string | undefined {
    const stack = (cause as { stack?: unknown } | null)?.stack;

    return typeof stack === 'string' ? stack : undefined;
}

/** The path of a file from a directory, with `/` on each platform */
function pathFrom(directory: string, file: string): string {
    return relative(directory, file).replaceAll(sep, '/');
}

/** The results of a test file's tests, which its row prints */
class FileResults {
    readonly #file: string;
    readonly #cwd: string;
    /** The directory that the file and its errors' frames are named from */
    readonly #directory: string;
    readonly #project: Project | undefined;
    readonly #path: string;
    readonly #label: string;
    readonly #counts = new Counts();
    readonly #failures: Failure[] = [];
    /** The names of the suites and the test that are running, by nesting */
    readonly #running: string[] = [];
    /** Of its tests and suites that aren't in a suite */
    #duration = 0;

    /** Of the file at the absolute path, which is named from `cwd` */
    constructor(file: string, project: Project | undefined, cwd: string) {
        const directory = project?.directory ?? cwd;
        const path = pathFrom(directory, file);

        this.#file = file;
        this.#cwd = cwd;
        this.#directory = directory;
        this.#project = project;
        this.#path = path;
        this.#label =
            project == null ? path : `${formatProject(project)} ${path}`;
    }

    file(): string {
        return this.#file;
    }

    counts(): Counts {
        return this.#counts;
    }

    failed(): boolean {
        return this.#failures.length > 0;
    }

    start({ name, nesting }: TestStart['data']): void {
        this.#running.length = nesting;
        this.#running.push(name);
    }

    add(result: TestResult): void {
        const { name, nesting, details } = result.data;

        const isFile = this.#isFile(name, nesting);

        if (nesting === 0) {
            this.#duration += details.duration_ms;
        }
        if (details.type !== 'suite' && !isFile) {
            this.#counts.add(result);
        }
        if (result.type === 'test:fail') {
            this.#addFailure(
                result,
                isFile ? [] : [...this.#running.slice(0, nesting), name],
                details.type !== 'suite' && !isFile
            );
        }
    }

    /**
     * Whether a result is of the file itself, rather than of a test in it.
     * node:test reports a file that fails as it loads, or none of whose
     * tests ran, as a test named by its path. It isn't counted as a test
     * here: its failure fails the file, under the row's own title.
     */
    #isFile(name: string, nesting: number): boolean {
        return nesting === 0 && resolve(this.#cwd, name) === this.#file;
    }

    #addFailure({ data }: TestFail, titles: string[], isTest: boolean): void {
        const { error, duration_ms: duration } = data.details;
        // node:test wraps what the test threw in an error of its own, as
        // its cause
        const cause = error.cause ?? error;

        // A suite fails with its tests, whose own failures say why, and a
        // test to do may fail
        if (
            failureType(error) === 'subtestsFailed' ||
            isSet(data.todo) ||
            isSet(data.skip)
        ) {
            return;
        }

        this.#failures.push({
            titles,
            isTest,
            duration,
            error: formatError(cause),
            cause,
            declared: {
                file: data.file ?? this.#file,
                line: data.line ?? 1,
                column: data.column ?? 1
            }
        });
    }

    /** The file's row, and a line for each of its failures */
    formatRow(): string {
        const total = this.#counts.total();
        const { failed, skipped, todo } = this.#counts;
        const counts = [
            `${total} ${total === 1 ? 'test' : 'tests'}`,
            failed > 0 ? styleText('red', `${failed} failed`) : '',
            skipped > 0 ? styleText('yellow', `${skipped} skipped`) : '',
            todo > 0 ? styleText('gray', `${todo} todo`) : ''
        ].filter(part => part !== '');

        const mark = this.failed()
            ? styleText('yellow', '❯')
            : styleText('green', '✓');
        const duration = styleText('gray', formatDuration(this.#duration));
        const row = ` ${mark} ${this.#label} ${styleText('gray', `(${counts.join(' | ')})`)} ${duration}\n`;

        return (
            row +
            this.#failures.map(failure => formatFailedTest(failure)).join('')
        );
    }

    /**
     * The errors of the file's failed tests, or of its failed suites and of
     * the file itself, each under its file and titles
     */
    formatErrors(ofTests: boolean): string[] {
        return this.#failures
            .filter(({ isTest }) => isTest === ofTests)
            .map(({ titles, error }) => {
                const title = [this.#label, ...titles].join(' > ');

                return `${FAIL} ${title}\n${error}\n`;
            });
    }

    /** Each of the file's failures, as GitHub Actions annotates it */
    annotations(): Annotation[] {
        return this.#failures.map(failure => this.#annotate(failure));
    }

    /**
     * A failure under the title that Vitest's reporter gives it, as
     * `[project] file > suite > test`, with its error's name and message,
     * and the frames of its stack in the project's own code, as Vitest
     * prints an error. It's at the innermost of those, or where it was
     * declared.
     */
    #annotate({ titles, error, cause, declared }: Failure): Annotation {
        const name = [this.#path, ...titles].join(' > ');
        const title =
            this.#project == null ? name : `[${this.#project.name}] ${name}`;

        const stack = stackOf(cause);
        if (stack == null) {
            const message = stripVTControlCharacters(error);

            return { ...declared, title, message };
        }

        const { head, frames } = parseStack(stack);
        const lines = frames.map(
            ({ file, line, column }) =>
                ` ❯ ${pathFrom(this.#directory, file)}:${line}:${column}`
        );
        const message = [head, ...lines].join('\n');

        return { ...(frames[0] ?? declared), title, message };
    }
}

/** The line of a failed test under its file's row. The file itself has none. */
function formatFailedTest({ titles, duration }: Failure): string {
    if (titles.length === 0) {
        return '';
    }

    const time = styleText('gray', formatDuration(duration));

    return `   ${styleText('red', '×')} ${titles.join(' > ')} ${time}\n`;
}

/** The test file of an event's test, or else the file that declared it */
function testFile(data: {
    file?: string;
    entryFile?: string;
}): string | undefined {
    return data.entryFile ?? data.file;
}

/**
 * The errors under a heading with their number, as `Failed Tests 2`, or
 * nothing without errors
 */
function formatErrors(heading: string, errors: readonly string[]): string {
    if (errors.length === 0) {
        return '';
    }

    const title = styleText(['bold', 'red'], ` ${heading} ${errors.length}`);

    return `\n${title}\n\n${errors.join('\n')}`;
}

/** A line of the totals, whose labels end in the same column */
function formatTotal(label: string, value: string): string {
    return `${styleText('gray', label.padStart(11))}  ${value}\n`;
}

/** The report of a run, which takes node:test's events and gives the text to print */
class Report {
    readonly #cwd: string;
    readonly #projects = new Projects();
    #files = new Counts();
    #tests = new Counts();
    /** Of the suites and the files that failed, which aren't failed tests */
    #suiteErrors: string[] = [];
    #testErrors: string[] = [];
    /** The workflow commands of the failures, in a job of GitHub Actions */
    #commands: string[] = [];
    /** The file whose tests are being reported */
    #current: FileResults | undefined;
    readonly #github: GitHubActions | undefined;

    /**
     * Names the files that have no project from `cwd`, and reports to the
     * job of GitHub Actions that the run is in, if any
     */
    constructor(cwd: string, github: GitHubActions | undefined) {
        this.#cwd = cwd;
        this.#github = github;
    }

    /** What to print for the event, which is nothing for most */
    print(event: TestEvent): string {
        switch (event.type) {
            case 'test:start': {
                return this.#in(testFile(event.data), results => {
                    results.start(event.data);
                });
            }
            case 'test:pass':
            case 'test:fail': {
                return this.#in(testFile(event.data), results => {
                    results.add(event);
                });
            }
            case 'test:summary': {
                return this.#summarize(event.data);
            }
            case 'test:diagnostic': {
                const { file, message } = event.data;

                return !file && TOTAL.test(message)
                    ? ''
                    : `${styleText('blue', `ℹ ${message}`)}\n`;
            }
            case 'test:stdout':
            case 'test:stderr': {
                return event.data.message;
            }
            case 'test:coverage': {
                return formatCoverage(event);
            }
            default: {
                return '';
            }
        }
    }

    /**
     * Has `record` take an event of the file's results, after ending the
     * file before it, whose row it returns
     */
    #in(
        file: string | undefined,
        record: (results: FileResults) => void
    ): string {
        if (!file) {
            return '';
        }

        const ended = this.#current?.file() === file ? '' : this.#endFile();
        this.#current ??= new FileResults(
            file,
            this.#projects.of(file),
            this.#cwd
        );
        record(this.#current);

        return ended;
    }

    /** The row of the current file, whose results go to the totals */
    #endFile(): string {
        const results = this.#current;
        if (results == null) {
            return '';
        }
        this.#current = undefined;

        this.#tests.addAll(results.counts());
        if (results.failed()) {
            this.#files.failed++;
        } else {
            this.#files.passed++;
        }
        this.#suiteErrors.push(...results.formatErrors(false));
        this.#testErrors.push(...results.formatErrors(true));
        if (this.#github != null) {
            for (const annotation of results.annotations()) {
                this.#commands.push(formatErrorCommand(annotation));
            }
        }

        return results.formatRow();
    }

    /**
     * Ends the file that a summary is of, if its tests are the last
     * reported, or the run, if the summary is of all files. Under
     * `--watch`, another run follows, so the totals start over.
     */
    #summarize({
        file,
        duration_ms: duration
    }: {
        file?: string;
        duration_ms: number;
    }): string {
        if (file) {
            return this.#current?.file() === file ? this.#endFile() : '';
        }

        const row = this.#endFile();
        const errors =
            formatErrors('Failed Suites', this.#suiteErrors) +
            formatErrors('Failed Tests', this.#testErrors);
        const totals =
            formatTotal('Test Files', this.#files.format()) +
            formatTotal('Tests', this.#tests.format()) +
            formatTotal('Duration', formatDuration(duration));
        // Each after an empty line, as Vitest prints them
        const commands = this.#commands
            .map(command => `\n${command}\n`)
            .join('');
        const warning = this.#github?.summarize(this.#files, this.#tests) ?? '';

        this.#suiteErrors = [];
        this.#testErrors = [];
        this.#commands = [];
        this.#files = new Counts();
        this.#tests = new Counts();

        return `${row}${errors}\n${totals}\n${commands}${warning}`;
    }
}

/** The table of the run's coverage, which node:test's `spec` reporter formats */
function formatCoverage(
    event: Extract<TestEvent, { type: 'test:coverage' }>
): string {
    const reporter = new spec();
    reporter.write(event);

    return (reporter.read() as string | null) ?? '';
}

/**
 * The reporter, as `--test-reporter=hypotes/reporter` loads it, and as the
 * stream of node:test's `run()` composes it. Besides the files' rows, the
 * errors and the totals, it prints what tests write to stdout and stderr,
 * their diagnostics, and the coverage as node:test's `spec` does. In a job
 * of GitHub Actions, it prints a workflow command for each failure too, and
 * appends the run's summary to the job's.
 */
export default async function* reporter(
    source: AsyncIterable<TestEvent>
): AsyncGenerator<string, void> {
    const report = new Report(process.cwd(), GitHubActions.from(process.env));

    for await (const event of source) {
        const text = report.print(event);

        if (text !== '') {
            yield text;
        }
    }
}
