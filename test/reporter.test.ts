import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, relative, sep } from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import type { TestEvent } from 'node:test/reporters';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { afterAll, afterEach, beforeEach, describe, expect, vi } from 'hypotes';
import { fc, it } from 'hypotes/fast-check';
import reporter from 'hypotes/reporter';

const PROJECTS = fileURLToPath(new URL('fixtures/projects', import.meta.url));
const MIXED = join(PROJECTS, 'alpha', 'test', 'mixed.spec.ts');
const DEEP = join(PROJECTS, 'alpha', 'test', 'nested', 'deep.spec.ts');
const PASSES = join(PROJECTS, 'alpha', 'test', 'passes.spec.ts');
const BROKEN = join(PROJECTS, 'beta', 'broken.ts');
const HOOK = join(PROJECTS, 'beta', 'hook.ts');
const THROUGH = join(PROJECTS, 'beta', 'through.ts');
const ANNOTATIONS = join(PROJECTS, 'beta', 'annotations.ts');
const ENTRY_FILE = fileURLToPath(new URL('fixtures/entry-file.ts', import.meta.url));
/** A module of this package's, which mocks a module, and one of whose tests fails */
const MOCKS = fileURLToPath(new URL('fixtures/mocks.ts', import.meta.url));

/** A directory for the summaries that the runs append to */
const SUMMARIES = mkdtempSync(join(tmpdir(), 'hypotes-reporter-'));
const SUMMARY = join(SUMMARIES, 'summary.md');
const UNUSED_SUMMARY = join(SUMMARIES, 'unused.md');

afterAll(() => {
    rmSync(SUMMARIES, { recursive: true, force: true });
});

/** The start of the escape sequences that colour text in a terminal */
const ESCAPE = '\u001B[';

interface RunOptions {
    /** Whether Node prints colours, which it doesn't to this pipe unless told to */
    readonly colors?: boolean;
    /** node:test's `--test-isolation` */
    readonly isolation?: 'none' | 'process';
    /** node:test's `--test-name-pattern`, which runs the tests that it matches */
    readonly namePattern?: string;
    /** The reporter's path or URL, which is `hypotes/reporter` unless given */
    readonly reporter?: string;
    /** A module to preload, as `hypotes/register` */
    readonly preload?: string;
    /**
     * The variables that GitHub Actions sets, which the run has none of
     * unless given, whether or not these tests run there
     */
    readonly github?: {
        readonly GITHUB_ACTIONS?: string;
        readonly GITHUB_STEP_SUMMARY?: string;
    };
}

/**
 * What the reporter prints for a run of the files in another process, with
 * each duration as `0ms`: node:test runs no files from a test file's
 */
async function report(
    files: readonly string[],
    {
        colors = false,
        isolation = 'process',
        namePattern,
        reporter: reporterPath = import.meta.resolve('hypotes/reporter'),
        preload,
        github
    }: RunOptions = {}
): Promise<string> {
    const env: NodeJS.ProcessEnv = { ...process.env, ...github };
    // Which tells node:test that it runs in a test file's process
    delete env.NODE_TEST_CONTEXT;
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    delete env.NODE_DISABLE_COLORS;
    if (colors) {
        env.FORCE_COLOR = '1';
    }
    if (github?.GITHUB_ACTIONS == null) {
        delete env.GITHUB_ACTIONS;
    }
    if (github?.GITHUB_STEP_SUMMARY == null) {
        delete env.GITHUB_STEP_SUMMARY;
    }
    delete env.GITHUB_WORKSPACE;

    const args = [
        ...(preload ? [`--import=${preload}`] : []),
        '--test',
        `--test-isolation=${isolation}`,
        `--test-reporter=${reporterPath}`,
        ...(namePattern ? [`--test-name-pattern=${namePattern}`] : []),
        ...files
    ];
    const stdout = await new Promise<string>(resolve => {
        // Which fails with the run, whose report is what's tested
        execFile(process.execPath, args, { env }, (_error, output) => {
            resolve(output);
        });
    });

    return stdout.replaceAll(/\d+ms/g, '0ms');
}

/** The lines of a report that are the rows of files and their failed tests */
function rows(text: string): string[] {
    return text.split('\n').filter(line => /^ {1,3}[✓❯×] /.test(line));
}

/** The lines of a report's totals */
function totals(text: string): string[] {
    return text.split('\n').filter(line => /^ +(?:Test Files|Tests|Duration) {2}/.test(line));
}

const [
    plain,
    shared,
    colored,
    filtered,
    entryFile,
    annotated,
    annotatedErrors,
    annotatedMocks,
    notInActions
] = await Promise.all([
    report([MIXED, DEEP, PASSES, BROKEN, HOOK, THROUGH]),
    report([MIXED, PASSES], { isolation: 'none' }),
    report([MIXED, PASSES], { colors: true }),
    report([DEEP, PASSES], { namePattern: 'adds' }),
    report([PASSES], { reporter: pathToFileURL(ENTRY_FILE).href }),
    report([MIXED, PASSES, BROKEN, HOOK], {
        colors: true,
        github: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: SUMMARY }
    }),
    report([ANNOTATIONS], { colors: true, github: { GITHUB_ACTIONS: 'true' } }),
    report([MOCKS], {
        preload: import.meta.resolve('hypotes/register'),
        github: { GITHUB_ACTIONS: 'true' }
    }),
    report([MIXED], {
        github: { GITHUB_ACTIONS: 'false', GITHUB_STEP_SUMMARY: UNUSED_SUMMARY }
    })
]);

/**
 * Whether this Node says which test file a test is from, as `entryFile`.
 * Node 24.13.1 doesn't, so there a test goes under the module that declares
 * it.
 */
const NAMES_TEST_FILE = entryFile === 'true';

describe('a run of files', () => {
    it('should print a row for each file, with its project and its counts', () => {
        expect(rows(plain)).toStrictEqual([
            ' ❯ |@fixture/alpha| test/mixed.spec.ts (5 tests | 1 failed | 1 skipped | 2 todo) 0ms',
            '   × outer > inner > fails 0ms',
            ' ✓ |@fixture/alpha| test/nested/deep.spec.ts (1 test) 0ms',
            ' ✓ |@fixture/alpha| test/passes.spec.ts (3 tests) 0ms',
            ' ❯ |beta| broken.ts (0 tests) 0ms',
            ' ❯ |beta| hook.ts (1 test) 0ms',
            '   × suite 0ms',
            NAMES_TEST_FILE
                ? ' ✓ |beta| through.ts (1 test) 0ms'
                : ' ✓ |@fixture/lib| declare.ts (1 test) 0ms'
        ]);
    });

    it.skipIf(!NAMES_TEST_FILE)(
        'should report a test under its test file, not the module that declares it',
        () => {
            expect(plain).not.toContain('@fixture/lib');
        }
    );

    it('should print the totals of files and tests', () => {
        expect(totals(plain)).toStrictEqual([
            ' Test Files  3 failed | 3 passed (6)',
            '      Tests  1 failed | 7 passed | 1 skipped | 2 todo (11)',
            '   Duration  0ms'
        ]);
    });

    it('should print the error of each failure under its file and titles', () => {
        expect(plain).toContain(' Failed Suites 2\n');
        expect(plain).toContain(' Failed Tests 1\n');
        expect(plain.indexOf(' Failed Suites ')).toBeLessThan(plain.indexOf(' Failed Tests '));
        expect(plain).toContain(
            ' FAIL |@fixture/alpha| test/mixed.spec.ts > outer > inner > fails\n' +
                'AssertionError [ERR_ASSERTION]: one is not two\n'
        );
        expect(plain).toContain(' FAIL |beta| hook.ts > suite\nError: the hook failed\n');
    });

    it("should print a file that fails as it loads, and what it wrote to stderr, without a test's title", () => {
        expect(plain).toContain('Error: broken as it loads');
        expect(plain).toContain(' FAIL |beta| broken.ts\n');
    });

    it('should not count a file none of whose tests ran as a test', () => {
        expect(rows(filtered)).toStrictEqual([
            ' ✓ |@fixture/alpha| test/nested/deep.spec.ts (0 tests) 0ms',
            ' ✓ |@fixture/alpha| test/passes.spec.ts (1 test) 0ms'
        ]);
    });

    it('should not report a test to do that fails as a failure', () => {
        expect(plain).not.toContain('is to do, and fails');
        expect(plain).not.toContain('not yet');
    });

    it("should leave out node:test's own totals", () => {
        expect(plain).not.toMatch(/^ℹ (?:tests|pass|fail) /m);
    });

    it('should print the same rows and totals for files that share a process', () => {
        expect(rows(shared)).toStrictEqual([
            ' ❯ |@fixture/alpha| test/mixed.spec.ts (5 tests | 1 failed | 1 skipped | 2 todo) 0ms',
            '   × outer > inner > fails 0ms',
            ' ✓ |@fixture/alpha| test/passes.spec.ts (3 tests) 0ms'
        ]);
        expect(totals(shared)).toStrictEqual([
            ' Test Files  1 failed | 1 passed (2)',
            '      Tests  1 failed | 4 passed | 1 skipped | 2 todo (8)',
            '   Duration  0ms'
        ]);
    });

    it('should have no colours where Node prints none', () => {
        expect(plain).not.toContain(ESCAPE);
    });

    it("should print a project's name on a background where Node prints colours", () => {
        expect(colored).toContain(ESCAPE);
        expect(colored).toContain(' @fixture/alpha ');
        expect(colored).not.toContain('|@fixture/alpha|');
    });
});

/** The line of a file that has the text, from 1 */
function lineOf(text: string, file: string): number {
    const lines = readFileSync(file, 'utf8').split('\n');

    return lines.findIndex(line => line.includes(text)) + 1;
}

/** A property's value in a workflow command, as GitHub's toolkit escapes it */
function property(value: string): string {
    return value.replaceAll('%', '%25').replaceAll(':', '%3A').replaceAll(',', '%2C');
}

/** The lines of a report that are workflow commands */
function commands(text: string): string[] {
    return text.split('\n').filter(line => line.startsWith('::'));
}

/** The line, the column and the message of each workflow command in a report */
function placements(text: string): Array<string[] | undefined> {
    return commands(text).map(command => /,line=(\d+),col=(\d+)::(.*)$/.exec(command)?.slice(1));
}

describe('a run in GitHub Actions', () => {
    it('should preserve multiline messages and remove colours from assertion diffs', () => {
        const [multiline, diff] = commands(annotatedErrors);

        expect(multiline).toContain(`::error file=${property(ANNOTATIONS)},`);
        expect(multiline).toContain(
            '::Error: Invalid input%0A    at least two values are required%0A    at /example.ts:1:2%0A ❯'
        );
        expect(diff).toContain('+ actual');
        expect(diff).not.toContain(ESCAPE);
    });

    it('should print the command of each error of an AggregateError, where it failed', () => {
        const first = lineOf("new Error('the first failed')", ANNOTATIONS);
        const second = lineOf("new TypeError('the second failed')", ANNOTATIONS);
        const title = '[beta] annotations.ts > fails with more than one error';
        const aggregated = commands(annotatedErrors).filter(command =>
            command.includes(`title=${title},`)
        );

        expect(aggregated).toStrictEqual([
            `::error file=${property(ANNOTATIONS)},title=${title},line=${first},col=19::` +
                `Error: the first failed%0A ❯ annotations.ts:${first}:19`,
            `::error file=${property(ANNOTATIONS)},title=${title},line=${second},col=20::` +
                `TypeError: the second failed%0A ❯ annotations.ts:${second}:20`
        ]);
    });

    it('should print the command of an error for each failure, where it failed', () => {
        const failed = lineOf('assert.equal(actual, expected', MIXED);
        const thrown = lineOf("throw new Error('the hook failed')", HOOK);

        expect(commands(annotated)).toStrictEqual([
            `::error file=${property(MIXED)},` +
                'title=[@fixture/alpha] test/mixed.spec.ts > outer > inner > fails,' +
                `line=${failed},col=20::AssertionError [ERR_ASSERTION]: one is not two` +
                `%0A%0A1 !== 2%0A ❯ test/mixed.spec.ts:${failed}:20`,
            // A file that fails as it loads has no error but node:test's
            // reason, and is where it starts
            `::error file=${property(BROKEN)},title=[beta] broken.ts,line=1,col=1::test failed`,
            `::error file=${property(HOOK)},title=[beta] hook.ts > suite,` +
                `line=${thrown},col=15::Error: the hook failed%0A ❯ hook.ts:${thrown}:15`
        ]);
    });

    it('should print the commands after the totals, each after an empty line', () => {
        const lines = annotated.split('\n');
        const duration = lines.findIndex(line => line.includes('Duration'));

        expect(lines.slice(duration + 1).map(line => line.slice(0, 7))).toStrictEqual([
            '',
            '',
            '::error',
            '',
            '::error',
            '',
            '::error',
            ''
        ]);
    });

    it('should print the commands without colours, where Node prints colours', () => {
        expect(annotated).toContain(ESCAPE);
        expect(commands(annotated).join('\n')).not.toContain(ESCAPE);
    });

    it('should place a failure in a module that hypotes/register transformed where it is written', () => {
        const line = lineOf("expect(value()).toBe('original')", MOCKS);

        expect(commands(annotatedMocks)).toHaveLength(1);
        expect(commands(annotatedMocks)[0]).toContain(
            `::error file=${property(MOCKS)},` +
                'title=[hypotes] test/fixtures/mocks.ts > a failure in a module that mocks points at its line,' +
                `line=${line},col=21::AssertionError: expected 'mocked' to be 'original'`
        );
        expect(commands(annotatedMocks)[0]).toContain(`%0A ❯ test/fixtures/mocks.ts:${line}:21`);
    });

    it("should append the run's summary to the job's", () => {
        expect(readFileSync(SUMMARY, 'utf8')).toBe(
            [
                '## hypotes Test Report',
                '',
                '### Summary',
                '',
                '- **Test Files**: ❌ **3 failures** · ✅ **1 pass** · 4 total',
                '- **Test Results**: ❌ **1 failure** · ✅ **5 passes** · 6 total',
                '- **Other**: 1 skip · 2 todos · 3 total',
                ''
            ].join('\n')
        );
    });

    it('should print no commands and write no summary outside GitHub Actions', () => {
        expect(commands(plain)).toStrictEqual([]);
        expect(commands(notInActions)).toStrictEqual([]);
        expect(() => readFileSync(UNUSED_SUMMARY)).toThrow('ENOENT');
    });
});

/** A file that no package is above, which has no project */
const LONE = join(parse(process.cwd()).root, 'hypotes-no-package', 'lone.test.ts');

type Outcome = 'fail' | 'pass' | 'skip' | 'todo';

/** The event of a test's result, as node:test reports it */
function result(file: string, name: string, outcome: Outcome): TestEvent {
    const error = Object.assign(new Error('wrapped', { cause: new Error(`${name} failed`) }), {
        failureType: 'testCodeFailure'
    });

    return {
        type: outcome === 'fail' ? 'test:fail' : 'test:pass',
        data: {
            file,
            name,
            nesting: 0,
            skip: outcome === 'skip' ? true : undefined,
            todo: outcome === 'todo' ? true : undefined,
            details: { duration_ms: 1, type: 'test', error }
        }
    } as unknown as TestEvent;
}

/**
 * The event of a test in the file that failed with the error, as node:test
 * reports what a test threw
 */
function failure(file: string, name: string, cause: unknown): TestEvent {
    const error = Object.assign(new Error('wrapped', { cause }), {
        failureType: 'testCodeFailure'
    });

    return {
        type: 'test:fail',
        data: {
            file,
            name,
            nesting: 0,
            line: 3,
            column: 5,
            details: { duration_ms: 1, type: 'test', error }
        }
    } as unknown as TestEvent;
}

/** An error with the stack, as one that another process threw has it */
function errorWithStack(stack: string): Error {
    return Object.assign(new Error('failed'), { stack });
}

/** The event that ends a run */
const END = { type: 'test:summary', data: { duration_ms: 5 } } as unknown as TestEvent;

/**
 * What the reporter prints for the events, which it's called with as
 * node:test calls it, without the colours that it has where this process
 * prints them, as it does when the run's results go to a terminal
 */
async function print(events: readonly TestEvent[]): Promise<string> {
    const chunks = await Array.fromAsync(reporter(Readable.from(events)));

    return stripVTControlCharacters(chunks.join(''));
}

describe('events', () => {
    // Which these tests' own process has, where they run in GitHub Actions
    beforeEach(() => {
        vi.stubEnv('GITHUB_ACTIONS', undefined);
        vi.stubEnv('GITHUB_STEP_SUMMARY', undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('should name a file without a project by its path from the working directory', async () => {
        const path = relative(process.cwd(), LONE).replaceAll(sep, '/');
        const text = await print([result(LONE, 'passes', 'pass'), END]);

        expect(rows(text)).toStrictEqual([` ✓ ${path} (1 test) 1ms`]);
    });

    it('should print totals of nothing for a run without tests', async () => {
        expect(totals(await print([END]))).toStrictEqual([
            ' Test Files  (0)',
            '      Tests  (0)',
            '   Duration  5ms'
        ]);
    });

    it('should start the totals over for the next run, as under --watch', async () => {
        const run = [result(LONE, 'passes', 'pass'), END];
        const text = await print([...run, ...run]);

        expect(totals(text).filter(line => line.includes('Tests'))).toStrictEqual([
            '      Tests  1 passed (1)',
            '      Tests  1 passed (1)'
        ]);
    });

    it.prop([fc.array(fc.constantFrom<Outcome>('fail', 'pass', 'skip', 'todo'))])(
        'should count each test once, by its result',
        async outcomes => {
            const events = outcomes.map((outcome, index) => result(LONE, `test ${index}`, outcome));
            const text = await print([...events, END]);

            const counted = ['failed', 'passed', 'skipped', 'todo'].map(label => {
                const match = new RegExp(`Tests .*?(\\d+) ${label}`).exec(text);
                return match == null ? 0 : Number(match[1]);
            });
            const expected = ['fail', 'pass', 'skip', 'todo'].map(
                outcome => outcomes.filter(each => each === outcome).length
            );

            expect(counted).toStrictEqual(expected);
            expect(text).toContain(`(${outcomes.length})\n`);
        }
    );
});

describe('events in GitHub Actions', () => {
    /** A file whose path has what a command's property escapes */
    const ODD = join(parse(process.cwd()).root, 'hypotes-no-package', 'a,b 100%', 'odd.test.ts');
    const ODD_PATH = relative(process.cwd(), ODD).replaceAll(sep, '/');

    beforeEach(() => {
        vi.stubEnv('GITHUB_ACTIONS', 'true');
        vi.stubEnv('GITHUB_STEP_SUMMARY', undefined);
        vi.stubEnv('GITHUB_WORKSPACE', undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("should escape a message's percent signs and line ends, and a property's colons and commas too", async () => {
        const error = errorWithStack(
            `Error: 100% of a, b: c\r\nand d\n    at ${pathToFileURL(ODD).href}:7:9`
        );
        const text = await print([failure(ODD, 'adds 1, 2: 3', error), END]);

        expect(commands(text)).toStrictEqual([
            `::error file=${property(ODD)},` +
                `title=${property(ODD_PATH)} > adds 1%2C 2%3A 3,line=7,col=9::` +
                `Error: 100%25 of a, b: c%0D%0Aand d%0A ❯ ${ODD_PATH.replaceAll('%', '%25')}:7:9`
        ]);
    });

    it('should name a Windows path as a stack does, with its colon escaped', async () => {
        const error = errorWithStack(
            'Error: failed\n    at fn (C:\\work\\a,b\\win.test.ts:4:2)\n    at node:internal/x:1:1'
        );
        const text = await print([failure(LONE, 'fails', error), END]);

        expect(commands(text)).toHaveLength(1);
        expect(commands(text)[0]).toContain('::error file=C%3A\\work\\a%2Cb\\win.test.ts,');
        expect(commands(text)[0]).toContain(',line=4,col=2::Error: failed%0A');
    });

    it('should select the first frame in the workspace or fall back to the declaration', async () => {
        const workspace = join(parse(process.cwd()).root, 'checkout');
        vi.stubEnv('GITHUB_WORKSPACE', workspace);

        const file = join(workspace, 'test.ts');
        const helper = join(workspace, '..helpers', 'check.ts');
        const outside = `    at ${join(workspace + '-tools', 'assert.ts')}:1:2`;
        const inside = `    at ${helper}:7:9\n    at ${file}:12:4`;
        const text = await print([
            failure(file, 'calls a helper', errorWithStack(`Error: failed\n${outside}\n${inside}`)),
            failure(file, 'has no local frame', errorWithStack(`Error: failed\n${outside}`)),
            END
        ]);

        const [local, fallback] = commands(text);
        expect(local).toContain(`::error file=${property(helper)},`);
        expect(local).toContain(',line=7,col=9::');
        expect(fallback).toContain(`::error file=${property(file)},`);
        expect(fallback).toContain(',line=3,col=5::');
    });

    it.each([
        ['outside the project', '    at fn (file:///work/node_modules/pkg/index.js:1:1)'],
        ["in Node's internals", '    at Test.run (node:internal/test_runner/test:1402:25)'],
        ['at all', '']
    ])(
        'should place a failure whose stack has no frame %s where its test was declared',
        async (_, frame) => {
            const error = errorWithStack(`Error: failed\n${frame}`);
            const text = await print([failure(LONE, 'fails', error), END]);

            expect(commands(text)).toStrictEqual([
                `::error file=${property(LONE)},` +
                    `title=${property(relative(process.cwd(), LONE).replaceAll(sep, '/'))} > fails,` +
                    'line=3,col=5::Error: failed'
            ]);
        }
    );

    it.prop([fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 5 })])(
        'should print a command for each error of an AggregateError, in order, at its own line',
        async lines => {
            const url = pathToFileURL(LONE).href;
            const path = relative(process.cwd(), LONE).replaceAll(sep, '/');
            const errors = lines.map((line, index) =>
                errorWithStack(`Error: error ${index}\n    at ${url}:${line}:2`)
            );
            const text = await print([
                failure(LONE, 'fails', new AggregateError(errors, 'failed')),
                END
            ]);

            expect(placements(text)).toStrictEqual(
                lines.map((line, index) => [
                    String(line),
                    '2',
                    `Error: error ${index}%0A ❯ ${path}:${line}:2`
                ])
            );
        }
    );

    it('should unpack one level of an AggregateError, and print one without errors itself', async () => {
        const nested = Object.assign(new AggregateError([new Error('inner')], 'nested'), {
            stack: 'AggregateError: nested'
        });
        const empty = Object.assign(new AggregateError([], 'none'), {
            stack: 'AggregateError: none'
        });
        const text = await print([
            failure(
                LONE,
                'fails with nested errors',
                new AggregateError([nested, 'a reason'], 'outer')
            ),
            failure(LONE, 'fails with no errors', empty),
            END
        ]);

        // Each where its test was declared, since none has a frame
        expect(placements(text)).toStrictEqual([
            ['3', '5', 'AggregateError: nested'],
            ['3', '5', 'a reason'],
            ['3', '5', 'AggregateError: none']
        ]);
    });

    it('should print what a test threw that is no error', async () => {
        const text = await print([failure(LONE, 'fails', { reason: 'a\nb' }), END]);

        expect(commands(text)).toHaveLength(1);
        expect(commands(text)[0]).toMatch(/,line=3,col=5::\{ reason: 'a\\nb' \}$/);
    });

    it('should print no command for a test that passed, was skipped, or is to do', async () => {
        const text = await print([
            result(LONE, 'passes', 'pass'),
            result(LONE, 'is skipped', 'skip'),
            result(LONE, 'is to do', 'todo'),
            END
        ]);

        expect(commands(text)).toStrictEqual([]);
    });

    it('should start the commands over for the next run, as under --watch', async () => {
        const run = [result(LONE, 'fails', 'fail'), END];

        expect(commands(await print([...run, ...run]))).toHaveLength(2);
    });

    it("should say that it couldn't write the summary, and not fail", async () => {
        // A directory, which can't be appended to
        vi.stubEnv('GITHUB_STEP_SUMMARY', SUMMARIES);
        const text = await print([result(LONE, 'passes', 'pass'), END]);

        expect(text).toContain(`Could not write the job summary to ${SUMMARIES}: `);
        expect(totals(text)).toHaveLength(3);
    });
});
