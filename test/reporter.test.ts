import { execFile } from 'node:child_process';
import { join, parse, relative, sep } from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import type { TestEvent } from 'node:test/reporters';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { describe, expect } from 'hypotes';
import { fc, it } from 'hypotes/fast-check';
import reporter from 'hypotes/reporter';

const PROJECTS = fileURLToPath(new URL('fixtures/projects', import.meta.url));
const MIXED = join(PROJECTS, 'alpha', 'test', 'mixed.ts');
const DEEP = join(PROJECTS, 'alpha', 'test', 'nested', 'deep.ts');
const PASSES = join(PROJECTS, 'alpha', 'test', 'passes.ts');
const BROKEN = join(PROJECTS, 'beta', 'broken.ts');
const HOOK = join(PROJECTS, 'beta', 'hook.ts');
const THROUGH = join(PROJECTS, 'beta', 'through.ts');
const ENTRY_FILE = fileURLToPath(new URL('fixtures/entry-file.ts', import.meta.url));

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
        reporter: reporterPath = import.meta.resolve('hypotes/reporter')
    }: RunOptions = {}
): Promise<string> {
    const env = { ...process.env };
    // Which tells node:test that it runs in a test file's process
    delete env.NODE_TEST_CONTEXT;
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    delete env.NODE_DISABLE_COLORS;
    if (colors) {
        env.FORCE_COLOR = '1';
    }

    const args = [
        '--test',
        `--test-isolation=${isolation}`,
        `--test-reporter=${reporterPath}`,
        ...(namePattern === undefined ? [] : [`--test-name-pattern=${namePattern}`]),
        ...files
    ];
    const stdout = await new Promise<string>(resolve => {
        // Which fails with the run, whose report is what's tested
        execFile(process.execPath, args, { env }, (_error, output) => {
            resolve(output);
        });
    });

    return stdout.replaceAll(/\d+ms/gu, '0ms');
}

/** The lines of a report that are the rows of files and their failed tests */
function rows(text: string): string[] {
    return text.split('\n').filter(line => /^ {1,3}[✓❯×] /u.test(line));
}

/** The lines of a report's totals */
function totals(text: string): string[] {
    return text.split('\n').filter(line => /^ +(?:Test Files|Tests|Duration) {2}/u.test(line));
}

const [plain, shared, colored, filtered, entryFile] = await Promise.all([
    report([MIXED, DEEP, PASSES, BROKEN, HOOK, THROUGH]),
    report([MIXED, PASSES], { isolation: 'none' }),
    report([MIXED, PASSES], { colors: true }),
    report([DEEP, PASSES], { namePattern: 'adds' }),
    report([PASSES], { reporter: pathToFileURL(ENTRY_FILE).href })
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
            ' ❯ |@fixture/alpha| test/mixed.ts (5 tests | 1 failed | 1 skipped | 2 todo) 0ms',
            '   × outer > inner > fails 0ms',
            ' ✓ |@fixture/alpha| test/nested/deep.ts (1 test) 0ms',
            ' ✓ |@fixture/alpha| test/passes.ts (3 tests) 0ms',
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
            ' FAIL |@fixture/alpha| test/mixed.ts > outer > inner > fails\n' +
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
            ' ✓ |@fixture/alpha| test/nested/deep.ts (0 tests) 0ms',
            ' ✓ |@fixture/alpha| test/passes.ts (1 test) 0ms'
        ]);
    });

    it('should not report a test to do that fails as a failure', () => {
        expect(plain).not.toContain('is to do, and fails');
        expect(plain).not.toContain('not yet');
    });

    it("should leave out node:test's own totals", () => {
        expect(plain).not.toMatch(/^ℹ (?:tests|pass|fail) /mu);
    });

    it('should print the same rows and totals for files that share a process', () => {
        expect(rows(shared)).toStrictEqual([
            ' ❯ |@fixture/alpha| test/mixed.ts (5 tests | 1 failed | 1 skipped | 2 todo) 0ms',
            '   × outer > inner > fails 0ms',
            ' ✓ |@fixture/alpha| test/passes.ts (3 tests) 0ms'
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
                const match = new RegExp(`Tests .*?(\\d+) ${label}`, 'u').exec(text);
                return match === null ? 0 : Number(match[1]);
            });
            const expected = ['fail', 'pass', 'skip', 'todo'].map(
                outcome => outcomes.filter(each => each === outcome).length
            );

            expect(counted).toStrictEqual(expected);
            expect(text).toContain(`(${outcomes.length})\n`);
        }
    );
});
