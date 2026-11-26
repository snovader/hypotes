import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'hypotes';

interface Result {
    readonly name: string;
    readonly passed: boolean;
    readonly skipped: boolean;
    readonly todo: boolean;
    readonly file: string | undefined;
    readonly line: number | undefined;
    readonly error: string;
}

interface RunOptions {
    /**
     * Whether Node prints colours, as it does to a terminal, or doesn't, as to
     * a file. As this process does, unless set.
     */
    readonly colors?: boolean;
    /** Runs only the tests marked only */
    readonly only?: boolean;
    /** Preloads hypotes/register, for module mocks */
    readonly register?: boolean;
    /**
     * Preloads a load hook before hypotes/register, so that it runs after it,
     * through its `nextLoad`
     */
    readonly hook?: string;
    /** Runs with --enable-source-maps, with which node:test maps the sites of tests */
    readonly sourceMaps?: boolean;
}

const RESULTS = fileURLToPath(new URL('fixtures/results.ts', import.meta.url));
const DECLARATIONS = fileURLToPath(new URL('fixtures/declarations.ts', import.meta.url));
const RUNNING_TEST = fileURLToPath(new URL('fixtures/running-test.ts', import.meta.url));
const ONLY = fileURLToPath(new URL('fixtures/only.ts', import.meta.url));
const MOCKS = fileURLToPath(new URL('fixtures/mocks.ts', import.meta.url));
const NESTED = fileURLToPath(new URL('fixtures/nested.ts', import.meta.url));
const CRLF = fileURLToPath(new URL('fixtures/crlf.ts', import.meta.url));
const COLORS = fileURLToPath(new URL('fixtures/colors.ts', import.meta.url));
const PREPENDED = fileURLToPath(new URL('fixtures/prepended.ts', import.meta.url));
/** The hook that prepends lines to `PREPENDED`, and maps them out */
const PREPEND_LINES = new URL('fixtures/prepend-lines.ts', import.meta.url).href;

/** The start of the escape sequences that colour text in a terminal */
const ESCAPE = '\u001B[';

/**
 * The results of a file's tests and suites, by title, from a run of it in
 * another process: node:test runs no files from a test file's
 */
async function resultsOf(
    file: string,
    { colors, hook, only = false, register = false, sourceMaps = false }: RunOptions = {}
): Promise<Map<string, Result>> {
    const env = { ...process.env };
    // Which tells node:test that it runs in a test file's process
    delete env.NODE_TEST_CONTEXT;
    if (colors != null) {
        // The process writes to a pipe, where Node prints colours only if
        // it's told to
        delete env.FORCE_COLOR;
        delete env.NO_COLOR;
        delete env.NODE_DISABLE_COLORS;
    }
    if (colors) {
        env.FORCE_COLOR = '1';
    }

    const preload = [
        ...(hook ? ['--import', hook] : []),
        ...(register ? ['--import', import.meta.resolve('hypotes/register')] : [])
    ];
    const flags = sourceMaps ? ['--enable-source-maps'] : [];
    const args = [...flags, ...preload, RESULTS, file, ...(only ? ['only'] : [])];
    const { stdout } = await promisify(execFile)(process.execPath, args, { env });
    const results = JSON.parse(stdout) as Result[];

    return new Map(results.map(result => [result.name, result]));
}

/** The line of the fixture on which the text first appears */
function lineOf(text: string, file = DECLARATIONS): number {
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.findIndex(line => line.includes(text)) + 1;
}

const [
    results,
    onlyResults,
    mockResults,
    mappedResults,
    nestedResults,
    unregisteredResults,
    crlfResults,
    plainResults,
    coloredResults,
    prependedResults,
    mappedPrependedResults,
    invalidMapResults,
    charsetMapResults,
    codeAfterMapResults,
    sectionsMapResults,
    runningResults
] = await Promise.all([
    resultsOf(DECLARATIONS),
    resultsOf(ONLY, { only: true }),
    resultsOf(MOCKS, { register: true }),
    resultsOf(MOCKS, { register: true, sourceMaps: true }),
    resultsOf(NESTED, { register: true }),
    resultsOf(MOCKS),
    resultsOf(CRLF, { register: true }),
    resultsOf(COLORS, { colors: false }),
    resultsOf(COLORS, { colors: true }),
    resultsOf(PREPENDED, { hook: PREPEND_LINES, register: true }),
    resultsOf(PREPENDED, { hook: PREPEND_LINES, register: true, sourceMaps: true }),
    resultsOf(PREPENDED, { hook: `${PREPEND_LINES}?map=invalid`, register: true }),
    resultsOf(PREPENDED, { hook: `${PREPEND_LINES}?map=charset`, register: true }),
    resultsOf(PREPENDED, { hook: `${PREPEND_LINES}?map=code-after`, register: true }),
    resultsOf(PREPENDED, { hook: `${PREPEND_LINES}?map=sections`, register: true }),
    resultsOf(RUNNING_TEST)
]);

/** The start of the error that Vitest 4 throws for options after the function */
const OPTIONS_AFTER_FUNCTION =
    'TypeError: Signature "test(name, fn, { ... })" was deprecated in Vitest 3 and removed in Vitest 4';

/** The result of the test or suite of the title, which ran */
function resultOf(title: string): Result {
    const result = results.get(title);
    expect(result, title).toBeDefined();
    return result as Result;
}

describe('declarations', () => {
    it.each([
        'each spreads 1 and a',
        'each spreads 2 and b',
        'each passes row 0 whole unless every row is an array',
        'each passes row 1 whole unless every row is an array',
        'each names a with -0',
        'for passes [1, 2] whole, and the context',
        'each takes a table, 1 + 2 is 3',
        'each takes a table, 2 + 3 is 5',
        'for takes a table, x',
        'each takes the strings of a template without values as rows, 0',
        'skipIf runs if false',
        'runIf runs if true',
        'test is it',
        'describe.each A',
        'declares tests in the suite',
        'describe.each takes a table, B',
        'declares tests in the suite of the row',
        'describe.for takes a table, C',
        'declares tests in the suite of the whole row',
        'hooks',
        'hooks run in the order that node:test runs them',
        'vi.fn records calls for the matchers',
        'prop takes parameters',
        'prop ran 7 times',
        'prop takes a record',
        'each is on the property API too, 1'
    ])('should run and pass "%s"', title => {
        expect(resultOf(title)).toMatchObject({ passed: true, skipped: false, todo: false });
    });

    it.each([
        'skip skips',
        'skip.each skips 1',
        'skipIf skips if true',
        'runIf skips if false',
        'options before the function apply',
        'describe.skip skips',
        'skip.prop skips'
    ])('should skip "%s"', title => {
        expect(resultOf(title)).toMatchObject({ skipped: true });
    });

    it.each(['todo is to do', 'a test without a function is to do'])(
        'should mark "%s" as to do',
        title => {
            expect(resultOf(title)).toMatchObject({ todo: true });
        }
    );

    it.each([
        ['a timeout after the function applies', 'timed out after 10ms'],
        ['a timeout applies while the timers are fake', 'timed out after 10ms'],
        ['options after the function throw, as in Vitest 4', OPTIONS_AFTER_FUNCTION],
        ['options after the function of each row throw', OPTIONS_AFTER_FUNCTION],
        ['two functions throw, as in Vitest', 'TypeError: Cannot use two functions as arguments'],
        ['prop awaits an async predicate', 'Property failed'],
        ['prop rejects a promise from a function that is not async', 'returned a promise'],
        ['prop fails on false', 'Property failed']
    ])('should fail "%s"', (title, message) => {
        const result = resultOf(title);

        expect(result.passed).toBe(false);
        expect(result.error).toContain(message);
    });

    it.each([
        ['each spreads 1 and a', "])('each spreads %i and %s'"],
        ['each takes a table, 1 + 2 is 3', "`('each takes a table, $a + $b is $sum'"],
        ['skip skips', "it.skip('skip skips'"],
        ['test is it', "test('test is it'"],
        ['prop takes parameters', 'property.prop([fc.nat()], { numRuns: 7 })(']
    ])('should report "%s" where the test file declares it', (title, declaration) => {
        expect(resultOf(title)).toMatchObject({ file: DECLARATIONS, line: lineOf(declaration) });
    });

    it('should run only the tests marked only, when asked to', () => {
        expect(onlyResults.get('only runs')?.passed).toBe(true);
        expect(onlyResults.get('the others are skipped')?.passed).not.toBe(false);
    });
});

describe('declarations in a module that mocks modules', () => {
    it('should run its tests with its mocks', () => {
        expect(mockResults.get('mocks are hoisted above the imports')).toMatchObject({
            passed: true,
            file: MOCKS,
            line: lineOf("it('mocks are hoisted above the imports'", MOCKS)
        });
    });

    it('should place its tests where they are with --enable-source-maps too', () => {
        expect(mappedResults.get('mocks are hoisted above the imports')).toMatchObject({
            passed: true,
            file: MOCKS,
            line: lineOf("it('mocks are hoisted above the imports'", MOCKS)
        });
    });

    it('should run and place the tests of a module whose lines, and hashbang, end in CRLF', () => {
        expect(crlfResults.get('mocks in a module whose lines end in CRLF')).toMatchObject({
            passed: true,
            file: CRLF,
            line: lineOf("it('mocks in a module whose lines end in CRLF'", CRLF)
        });
    });

    it('should report a failure where the module fails', () => {
        const result = mockResults.get('a failure in a module that mocks points at its line');
        const line = lineOf("expect(value()).toBe('original')", MOCKS);

        expect(result?.passed).toBe(false);
        expect(result?.error).toContain(`${MOCKS}:${line}:`);
    });

    it('should fail the module for a mock outside of its top level', () => {
        const line = lineOf("vi.mock('./later.ts'", NESTED);

        expect(nestedResults.get(NESTED)?.passed ?? false).toBe(false);
        expect(nestedResults.get(NESTED)?.error).toContain(
            `vi.mock('./later.ts') at ${NESTED}:${line}:5`
        );
    });

    it.each([
        ['', prependedResults],
        [' with --enable-source-maps', mappedPrependedResults],
        [' with charset=utf-8, followed by CRLF and whitespace', charsetMapResults],
        [' in two sections', sectionsMapResults]
    ])(
        'should place its tests where they are after a hook that maps its code%s',
        (_, prepended) => {
            expect(
                prepended.get('mocks are hoisted after a hook that maps its code')
            ).toMatchObject({
                passed: true,
                file: PREPENDED,
                line: lineOf("it('mocks are hoisted after a hook that maps its code'", PREPENDED)
            });
        }
    );

    it.each([
        ['', prependedResults],
        [' in two sections', sectionsMapResults]
    ])(
        'should report a failure where the module fails after a hook that maps its code%s',
        (_, prepended) => {
            const result = prepended.get(
                'a failure in a module that a hook maps points at its line'
            );
            const line = lineOf("expect(value()).toBe('original')", PREPENDED);

            expect(result?.passed).toBe(false);
            expect(result?.error).toContain(`${PREPENDED}:${line}:`);
        }
    );

    it.each([
        ["isn't JSON", invalidMapResults],
        ['is followed by code', codeAfterMapResults]
    ])(
        "should place its tests in the code as it's given after a hook whose map %s",
        (_, prepended) => {
            const line = lineOf(
                "it('mocks are hoisted after a hook that maps its code'",
                PREPENDED
            );

            expect(
                prepended.get('mocks are hoisted after a hook that maps its code')
            ).toMatchObject({
                passed: true,
                file: PREPENDED,
                // Below the hook's two lines
                line: line + 2
            });
        }
    );

    it('should keep the code that follows the map of a hook', () => {
        expect(codeAfterMapResults.get('code after the map runs')?.passed).toBe(true);
    });

    it('should fail the module without hypotes/register', () => {
        expect(unregisteredResults.get(MOCKS)?.error).toContain('--import hypotes/register');
    });
});

describe("the messages of a spy's matchers", () => {
    const TITLE = "a spy's matcher fails";

    it("should have no colours where Node prints none, as in a reporter's file", () => {
        const error = plainResults.get(TITLE)?.error;

        expect(error).toContain('1st vi.fn() call return:');
        expect(error).not.toContain(ESCAPE);
    });

    it('should have colours where Node prints them, as to a terminal', () => {
        expect(coloredResults.get(TITLE)?.error).toContain(ESCAPE);
    });
});

describe('what needs the test that is running', () => {
    /** The result of the test of the title, which ran */
    function runningResultOf(title: string): Result {
        const result = runningResults.get(title);
        expect(result, title).toBeDefined();
        return result as Result;
    }

    it.each([
        'throws outside a test, with Vitest messages',
        'runs its callbacks after afterEach, the last first',
        'ran the callbacks in the order that Vitest runs them',
        'ran the callbacks after the one that threw',
        'ran the callbacks of a test whose beforeEach hook threw',
        'has the callbacks on its context, with expect',
        'has the callbacks on the context of row',
        'ran the callbacks of the context',
        'went on after the soft assertions',
        'passes with soft assertions that pass',
        'ran onTestFailed for a soft assertion',
        'passes with as many assertions as expected',
        'passes with an assertion when it expects some',
        'counts the assertions of its own, while another runs',
        'counts its own assertions too',
        'counts the assertions of each run of a property',
        'polls until the matcher passes',
        'polls with a negated matcher',
        'polls in real time, and moves fake timers forward',
        'fails passes a test that throws',
        'fails passes a test with a soft failure',
        'fails passes a test with fewer assertions than expected',
        'fails as an option',
        'fails.each 2',
        'passes its test that throws',
        'fails.prop passes a failed property'
    ])('should pass "%s"', title => {
        expect(runningResultOf(title)).toMatchObject({ passed: true, skipped: false });
    });

    it.each([
        ['runs the callbacks of a failed test after the others', "expected 'test' to be 'passed'"],
        ['fails with the error of a callback, and runs the others', 'Error: the callback threw'],
        ['fails with a callback that times out', 'Hook timed out in 10ms.'],
        ['still runs the callbacks of the hook', 'Error: beforeEach threw'],
        [
            'has a context whose callbacks throw in a callback',
            'Cannot call "onTestFinished" inside a test hook.'
        ],
        ['fails with a soft assertion that a promise fails', 'expected 1 to be 2'],
        ['fails the test', "expected 'afterEach' to be 'passing'"],
        ['runs onTestFailed for a soft assertion', 'expected 1 to be 2'],
        [
            'fails with fewer assertions than expected',
            'expected number of assertions to be 2, but got 1'
        ],
        [
            'fails with no assertions when it expects some',
            'expected any number of assertion, but got none'
        ],
        [
            'fails with what it throws rather than its count of assertions',
            'threw rather than counted'
        ],
        [
            'fails with a promise that it did not await',
            'Promise returned by `expect(actual).resolves.toBe(expected)` was not awaited.'
        ],
        ['fails with the last error of a poll', 'the value: expected 1 to be 2'],
        [
            'fails with a poll that it did not await',
            'expect.poll(assertion).toBe() was not awaited.'
        ],
        ['fails fails a test that passes', 'Expect test to fail'],
        ['fails.each 1', 'Expect test to fail'],
        ['fails its test that passes', 'Expect test to fail']
    ])('should fail "%s"', (title, message) => {
        const result = runningResultOf(title);

        expect(result.passed).toBe(false);
        expect(result.error).toContain(message);
    });

    it('should fail with each error of the soft assertions, in its message', () => {
        const { error } = runningResultOf(
            'fails with each error of its soft assertions, and goes on'
        );

        expect(error).toContain('2 errors:');
        expect(error).toContain('1. AssertionError: expected 1 to be 2');
        expect(error).toContain(
            '2. AssertionError: an object: expected { a: 1 } to deeply equal { a: 2 }'
        );
    });

    it('should fail with a soft error and then what the test threw', () => {
        const { error } = runningResultOf('fails with a soft assertion and what it throws after');

        expect(error).toContain("1. AssertionError: expected 'soft' to be 'hard'");
        expect(error).toContain('2. Error: threw after');
    });

    it('should fail with the errors of two callbacks, the last added first', () => {
        const { error } = runningResultOf('fails with the errors of two callbacks');

        expect(error).toContain('1. Error: the second callback threw');
        expect(error).toContain('2. Error: the first callback threw');
    });

    it.each([
        ['collects its own soft errors, while another runs', "'first'", "'second'"],
        ['collects its own soft errors too', "'second'", "'first'"]
    ])('should fail "%s" with its own soft error only', (title, own, other) => {
        const { error } = runningResultOf(title);

        expect(error).toContain(own);
        expect(error).not.toContain(other);
    });

    it('should skip a test that fails and is skipped', () => {
        expect(runningResultOf('skip.fails skips')).toMatchObject({ skipped: true });
    });

    it.each([
        ['fails passes a test that throws', "it.fails('fails passes a test that throws'"],
        ['fails.each 1', "test.fails.each([1, 2])('fails.each %i'"],
        ['fails.prop passes a failed property', 'property.fails.prop([fc.nat()])(']
    ])('should report "%s" where the test file declares it', (title, declaration) => {
        expect(runningResultOf(title)).toMatchObject({
            file: RUNNING_TEST,
            line: lineOf(declaration, RUNNING_TEST)
        });
    });
});
