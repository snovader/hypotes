import plugin from 'hypotes/oxlint';
import { tester } from './rule-tester.ts';

// What the rules recognize: tests, describe blocks, expect() and vi from
// hypotes, and tests with `prop` from its fast-check subpath
const IMPORTS = [
    "import { describe, expect, suite, vi } from 'hypotes';",
    "import { it, test } from 'hypotes/fast-check';"
].join('\n');

/** Code that imports what the rules recognize */
function imported(code: string): string {
    return `${IMPORTS}\n${code}`;
}

const NO_ASSERTION =
    'Expected the test to call expect(), or a function whose name starts with expect';

tester.run('expect-expect', plugin.rules['expect-expect'], {
    valid: [
        imported("it('asserts', () => { expect(1).toBe(1); });"),
        imported("test('asserts', { skip: true }, () => { expect(1).toBe(1); });"),
        imported("it('asserts through a helper', () => { expectOne(1); });"),
        imported(
            "it('asserts in a callback', () => { [1].forEach(value => { expect(value).toBe(1); }); });"
        ),
        imported("it.prop([arbitrary])('asserts', value => { expect(value).toBe(value); });"),
        imported("it.each([1])('asserts %i', value => { expect(value).toBe(1); });"),
        imported("it.for([1])('asserts %i', (value, context) => { expect(value).toBe(1); });"),
        imported("it.each`a\n${1}`('asserts $a', ({ a }) => { expect(a).toBe(1); });"),
        imported("it.skipIf(skipped).only('asserts', () => { expect(1).toBe(1); });"),
        imported("it.todo('is to be written');"),
        imported("it('runs a function declared elsewhere', check);"),
        imported("describe('has no assertions of its own', () => {});"),
        // An `it` that isn't hypotes'
        "function it(name: string, run: () => void): void { run(); }\nit('runs', () => {});"
    ],
    invalid: [
        {
            name: 'a test that asserts nothing',
            code: imported("it('asserts nothing', () => {});"),
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a test with a timeout after its function',
            code: imported("it('asserts nothing', () => {}, 10);"),
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a test in a describe block',
            code: imported(
                "describe('a block', () => { test('computes', () => { const value = 1; }); });"
            ),
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a variant of a test',
            code: imported("it.only('asserts nothing', function () {});"),
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a property that returns a boolean',
            code: imported("it.prop([arbitrary])('holds', value => value >= 0);"),
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a test of each row',
            code: imported("it.skip.each([1, 2])('asserts nothing about %i', value => {});"),
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a test of each row of a table in a template literal',
            code: imported("it.for`a\n${1}`('asserts nothing about $a', row => {});"),
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a test that runs on a condition',
            code: imported("test.runIf(enabled)('asserts nothing', () => {});"),
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a test imported under another name',
            code: "import { it as check } from 'hypotes';\ncheck('asserts nothing', () => {});",
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: "a test of node:test's",
            code: "import { it } from 'node:test';\nit('asserts nothing', () => {});",
            errors: [{ message: NO_ASSERTION }]
        },
        {
            name: 'a call of an expect helper beside the test',
            code: imported("expectOne(1);\nit('asserts nothing', () => {});"),
            errors: [{ message: NO_ASSERTION }]
        }
    ]
});

const STANDALONE =
    'Expected expect() in a test, or in a function of its own, rather than in a describe block or at the top of the module';

tester.run('no-standalone-expect', plugin.rules['no-standalone-expect'], {
    valid: [
        imported("it('asserts', () => { expect(1).toBe(1); });"),
        imported("it.prop([arbitrary])('asserts', value => { expect(value).toBe(value); });"),
        imported("it.each([1])('asserts %i', value => { expect(value).toBe(1); });"),
        imported("it.for`a\n${1}`('asserts $a', ({ a }) => { expect(a).toBe(1); });"),
        imported(
            "test('asserts in a callback', () => { [1].forEach(value => { expect(value).toBe(1); }); });"
        ),
        imported('function expectOne(value: number): void { expect(value).toBe(1); }'),
        imported(
            "describe('a block', () => { const check = (): void => { expect(1).toBe(1); }; it('checks', check); });"
        ),
        // An asymmetric matcher, rather than an assertion
        imported('const ANY_NUMBER = expect.any(Number);'),
        // An `expect` that isn't imported
        'declare function expect(value: unknown): void;\nexpect(1);'
    ],
    invalid: [
        {
            name: 'an assertion at the top of the module',
            code: imported('expect(1).toBe(1);'),
            errors: [{ message: STANDALONE }]
        },
        {
            name: 'an assertion in a describe block',
            code: imported("describe('a block', () => { expect(1).toBe(1); });"),
            errors: [{ message: STANDALONE }]
        },
        {
            name: 'an assertion in a suite',
            code: imported("suite('a suite', () => { expect(1).toBe(1); });"),
            errors: [{ message: STANDALONE }]
        },
        {
            name: 'an assertion in a callback at the top of the module',
            code: imported('[1].forEach(value => { expect(value).toBe(1); });'),
            errors: [{ message: STANDALONE }]
        },
        {
            name: 'an assertion in a callback in a describe block',
            code: imported(
                "describe.skip('a block', () => { [1].forEach(value => { expect(value).toBe(1); }); });"
            ),
            errors: [{ message: STANDALONE }]
        },
        {
            name: 'an assertion in a describe block of each row',
            code: imported(
                "describe.each([1])('a block for %i', value => { expect(value).toBe(1); });"
            ),
            errors: [{ message: STANDALONE }]
        },
        {
            name: 'an assertion in a describe block of each row of a table',
            code: imported(
                "describe.each`a\n${1}`('a block for $a', ({ a }) => { expect(a).toBe(1); });"
            ),
            errors: [{ message: STANDALONE }]
        }
    ]
});

const NO_MATCHER = 'Expected a matcher, such as toBe(), to be called on expect()';
const NOT_AWAITED = 'Expected the promise of .resolves or .rejects to be awaited or returned';

tester.run('valid-expect', plugin.rules['valid-expect'], {
    valid: [
        imported('expect(1).toBe(1);'),
        imported('expect(1).not.toBe(2);'),
        imported("expect(1, 'a message').toBe(1);"),
        imported('await expect(promise).resolves.toBe(1);'),
        imported(
            'async function check(): Promise<void> { return expect(promise).rejects.toThrow(); }'
        ),
        imported('const check = (): Promise<void> => expect(promise).resolves.not.toBe(1);'),
        imported(
            'await Promise.all([expect(first).resolves.toBe(1), expect(second).rejects.toThrow()]);'
        ),
        imported(
            'const check = (): Promise<unknown> => Promise.allSettled([expect(promise).resolves.toBe(1)]);'
        )
    ],
    invalid: [
        {
            name: 'no matcher',
            code: imported('expect(1);'),
            errors: [{ message: NO_MATCHER }]
        },
        {
            name: 'a matcher that is named but not called',
            code: imported('expect(1).toBe;'),
            errors: [{ message: NO_MATCHER }]
        },
        {
            name: 'a modifier without a matcher',
            code: imported('expect(1).not;'),
            errors: [{ message: NO_MATCHER }]
        },
        {
            name: 'a promise that is neither awaited nor returned',
            code: imported('expect(promise).resolves.toBe(1);'),
            errors: [{ message: NOT_AWAITED }]
        },
        {
            name: 'a promise in an array that is neither awaited nor returned',
            code: imported('Promise.all([expect(promise).resolves.toBe(1)]);'),
            errors: [{ message: NOT_AWAITED }]
        },
        {
            name: 'a promise in an array that no method of Promise takes',
            code: imported('await collect([expect(promise).resolves.toBe(1)]);'),
            errors: [{ message: NOT_AWAITED }]
        },
        {
            name: 'a promise in a function that returns something else',
            code: imported(
                'async function check(): Promise<number> { expect(promise).rejects.toThrow(); return 1; }'
            ),
            errors: [{ message: NOT_AWAITED }]
        }
    ]
});

tester.run('prefer-to-be', plugin.rules['prefer-to-be'], {
    valid: [
        imported('expect(value).toBe(1);'),
        imported('expect(value).toEqual({ a: 1 });'),
        imported('expect(value).toStrictEqual([1]);'),
        imported('expect(value).toEqual(/a/u);'),
        imported('expect(value).toEqual(`a${b}`);'),
        imported('expect(value).toStrictEqual(-value);'),
        imported('expect(value).toBeNull();'),
        imported('expect(value).not.toBeUndefined();'),
        // A comparison of something other than an imported `expect`
        'declare const check: (value: unknown) => { toEqual(value: unknown): void };\ncheck(1).toEqual(1);'
    ],
    invalid: [
        {
            name: 'a number',
            code: imported('expect(value).toEqual(1);'),
            output: imported('expect(value).toBe(1);'),
            errors: [{ message: 'Use toBe() rather than toEqual(1)' }]
        },
        {
            name: 'negative zero',
            code: imported('expect(value).toStrictEqual(-0);'),
            output: imported('expect(value).toBe(-0);'),
            errors: [{ message: 'Use toBe() rather than toStrictEqual(-0)' }]
        },
        {
            name: 'a string, negated',
            code: imported("expect(value).not.toEqual('a');"),
            output: imported("expect(value).not.toBe('a');"),
            errors: [{ message: "Use toBe() rather than toEqual('a')" }]
        },
        {
            name: 'a bigint, a boolean and a template without expressions',
            code: imported(
                'expect(a).toStrictEqual(1n);\nexpect(b).toEqual(true);\nexpect(c).toEqual(`c`);'
            ),
            output: imported('expect(a).toBe(1n);\nexpect(b).toBe(true);\nexpect(c).toBe(`c`);'),
            errors: [
                { message: 'Use toBe() rather than toStrictEqual(1n)' },
                { message: 'Use toBe() rather than toEqual(true)' },
                { message: 'Use toBe() rather than toEqual(`c`)' }
            ]
        },
        {
            name: 'null',
            code: imported('expect(value).toBe(null);'),
            output: imported('expect(value).toBeNull();'),
            errors: [{ message: 'Use toBeNull() rather than toBe(null)' }]
        },
        {
            name: 'undefined',
            code: imported('expect(value).toEqual(undefined);'),
            output: imported('expect(value).toBeUndefined();'),
            errors: [{ message: 'Use toBeUndefined() rather than toEqual(undefined)' }]
        },
        {
            name: 'not undefined',
            code: imported('expect(value).not.toBe(undefined);'),
            output: imported('expect(value).toBeDefined();'),
            errors: [{ message: 'Use toBeDefined() rather than not.toBe(undefined)' }]
        },
        {
            name: 'not undefined, resolved',
            code: imported('await expect(promise).resolves.not.toBe(undefined);'),
            output: imported('await expect(promise).resolves.toBeDefined();'),
            errors: [{ message: 'Use toBeDefined() rather than not.toBe(undefined)' }]
        },
        {
            name: 'NaN',
            code: imported('expect(value).toStrictEqual(NaN);'),
            output: imported('expect(value).toBeNaN();'),
            errors: [{ message: 'Use toBeNaN() rather than toStrictEqual(NaN)' }]
        }
    ]
});

tester.run('prefer-to-have-length', plugin.rules['prefer-to-have-length'], {
    valid: [
        imported('expect(values).toHaveLength(1);'),
        imported('expect(values.length).toBeGreaterThan(1);'),
        imported('expect(values.size).toBe(1);'),
        imported("expect(values['length']).toBe(1);"),
        imported('expect(values?.length).toBe(1);')
    ],
    invalid: [
        {
            name: 'toBe()',
            code: imported('expect(values.length).toBe(1);'),
            output: imported('expect(values).toHaveLength(1);'),
            errors: [{ message: 'Use toHaveLength() rather than comparing values.length' }]
        },
        {
            name: 'toEqual() of a call',
            code: imported('expect(values.at(0).length).toEqual(2);'),
            output: imported('expect(values.at(0)).toHaveLength(2);'),
            errors: [{ message: 'Use toHaveLength() rather than comparing values.at(0).length' }]
        },
        {
            name: 'not.toStrictEqual()',
            code: imported('expect(values.length).not.toStrictEqual(0);'),
            output: imported('expect(values).not.toHaveLength(0);'),
            errors: [{ message: 'Use toHaveLength() rather than comparing values.length' }]
        }
    ]
});

const FOCUSED = 'Expected every test to run, rather than those that .only marks';

tester.run('no-focused-tests', plugin.rules['no-focused-tests'], {
    valid: [
        imported("it('runs', () => { expect(1).toBe(1); });"),
        imported("describe.skip('a block', () => {});"),
        imported("it('runs', { only: false }, () => {});"),
        // An `it` that isn't hypotes'
        "declare const it: { only(name: string): void };\nit.only('runs');"
    ],
    invalid: [
        {
            name: 'a test',
            code: imported("it.only('runs alone', () => {});"),
            errors: [
                {
                    message: FOCUSED,
                    suggestions: [
                        { desc: 'Remove .only', output: imported("it('runs alone', () => {});") }
                    ]
                }
            ]
        },
        {
            name: 'a describe block of each row',
            code: imported("describe.only.each([1])('a block for %i', value => {});"),
            errors: [
                {
                    message: FOCUSED,
                    suggestions: [
                        {
                            desc: 'Remove .only',
                            output: imported("describe.each([1])('a block for %i', value => {});")
                        }
                    ]
                }
            ]
        },
        {
            name: 'a test of each row of a table',
            code: imported("it.only.each`a\n${1}`('runs alone with $a', ({ a }) => {});"),
            errors: [
                {
                    message: FOCUSED,
                    suggestions: [
                        {
                            desc: 'Remove .only',
                            output: imported(
                                "it.each`a\n${1}`('runs alone with $a', ({ a }) => {});"
                            )
                        }
                    ]
                }
            ]
        },
        {
            name: 'a test that runs on a condition',
            code: imported("test.runIf(enabled).only('runs alone', () => {});"),
            errors: [
                {
                    message: FOCUSED,
                    suggestions: [
                        {
                            desc: 'Remove .only',
                            output: imported("test.runIf(enabled)('runs alone', () => {});")
                        }
                    ]
                }
            ]
        },
        {
            name: 'the only option',
            code: imported("it('runs alone', { only: true }, () => {});"),
            errors: [
                {
                    message:
                        'Expected every test to run, rather than those that the only option marks'
                }
            ]
        },
        {
            name: "a test of node:test's",
            code: "import { it } from 'node:test';\nit.only('runs alone', () => {});",
            errors: [{ message: FOCUSED }]
        }
    ]
});

tester.run('no-disabled-tests', plugin.rules['no-disabled-tests'], {
    valid: [
        imported("it('runs', () => { expect(1).toBe(1); });"),
        imported("it.todo('is to be written');"),
        imported("it('is to be written', { todo: true });"),
        imported("it.skipIf(skipped)('runs on a condition', () => {});"),
        imported("test('runs', { skip: false }, () => {});"),
        // Options after the function, which TypeScript rejects, and hypotes
        // throws for, as Vitest does
        imported("test('runs', () => {}, { skip: true });"),
        imported("it('runs a function declared elsewhere', check);"),
        // valid-describe-callback reports a describe block without a function
        imported("describe('a block');")
    ],
    invalid: [
        {
            name: 'a test',
            code: imported("it.skip('is skipped', () => {});"),
            errors: [{ message: 'Expected the test to run, rather than be skipped with .skip' }]
        },
        {
            name: 'a describe block of each row',
            code: imported("describe.skip.each([1])('a block for %i', value => {});"),
            errors: [
                {
                    message: 'Expected the describe block to run, rather than be skipped with .skip'
                }
            ]
        },
        {
            name: 'a describe block of each row of a table',
            code: imported("describe.skip.for`a\n${1}`('a block for $a', row => {});"),
            errors: [
                {
                    message: 'Expected the describe block to run, rather than be skipped with .skip'
                }
            ]
        },
        {
            name: 'a suite',
            code: imported("suite.skip('a suite', () => {});"),
            errors: [
                {
                    message: 'Expected the describe block to run, rather than be skipped with .skip'
                }
            ]
        },
        {
            name: 'the skip option, with a reason',
            code: imported("test('is skipped', { skip: 'a reason' }, () => {});"),
            errors: [
                { message: 'Expected the test to run, rather than be skipped with the skip option' }
            ]
        },
        {
            name: 'a test without a function',
            code: imported("it('has no function');"),
            errors: [{ message: "Expected the test to have a function, without which it's to do" }]
        },
        {
            name: 'a test with options but without a function',
            code: imported("it('has no function', { timeout: 10 });"),
            errors: [{ message: "Expected the test to have a function, without which it's to do" }]
        }
    ]
});

tester.run('warn-todo', plugin.rules['warn-todo'], {
    valid: [
        imported("it('runs', () => { expect(1).toBe(1); });"),
        imported("it('is to be written', { todo: false }, () => {});"),
        // no-disabled-tests reports a test without a function
        imported("it('has no function');")
    ],
    invalid: [
        {
            name: 'a test',
            code: imported("it.todo('is to be written');"),
            errors: [
                {
                    message:
                        'Expected the test to be written, rather than marked as to do with .todo'
                }
            ]
        },
        {
            name: 'a describe block',
            code: imported("describe.todo('a block');"),
            errors: [
                {
                    message:
                        'Expected the describe block to be written, rather than marked as to do with .todo'
                }
            ]
        },
        {
            name: 'the todo option, with a reason',
            code: imported("test('is to be written', { todo: 'a reason' }, () => {});"),
            errors: [
                {
                    message:
                        'Expected the test to be written, rather than marked as to do with the todo option'
                }
            ]
        }
    ]
});

const NO_TEXT = 'Expected a title that has text';
const SPACES = 'Expected a title without spaces at its start or end';

tester.run('valid-title', plugin.rules['valid-title'], {
    valid: [
        imported("it('works', () => {});"),
        imported('describe(`a block`, () => {});'),
        imported('it(`works with ${value}`, () => {});'),
        imported('it(title, () => {});'),
        imported("it('item works', () => {});"),
        imported("test('tests it', () => {});"),
        imported("it.each([1])('works with %i', value => {});"),
        // Titles of calls other than declarations
        "declare function it(name: string): void;\nit('');"
    ],
    invalid: [
        {
            name: 'an empty string',
            code: imported("it('', () => {});"),
            errors: [{ message: NO_TEXT }]
        },
        {
            name: 'an empty template',
            code: imported('describe(``, () => {});'),
            errors: [{ message: NO_TEXT }]
        },
        {
            name: 'spaces at the start',
            code: imported("it('  works', () => {});"),
            output: imported("it('works', () => {});"),
            errors: [{ message: SPACES }]
        },
        {
            name: 'a space at the end of a template',
            code: imported('test(`works `, () => {});'),
            output: imported('test(`works`, () => {});'),
            errors: [{ message: SPACES }]
        },
        {
            name: 'an escaped tab, which the source can only remove by hand',
            code: imported("it('works\\t', () => {});"),
            output: null,
            errors: [{ message: SPACES }]
        },
        {
            name: 'the name of a test',
            code: imported("it('it works', () => {});"),
            output: imported("it('works', () => {});"),
            errors: [{ message: 'Expected the title not to start with it, which declares it' }]
        },
        {
            name: 'the name of a describe block',
            code: imported("describe('describe a block', () => {});"),
            output: imported("describe('a block', () => {});"),
            errors: [
                { message: 'Expected the title not to start with describe, which declares it' }
            ]
        },
        {
            name: 'the name of a suite, in a template',
            code: imported('suite(`suite of tests`, () => {});'),
            output: imported('suite(`of tests`, () => {});'),
            errors: [{ message: 'Expected the title not to start with suite, which declares it' }]
        },
        {
            name: 'the name of a test for each row',
            code: imported("test.each([1])('test %i', value => {});"),
            output: imported("test.each([1])('%i', value => {});"),
            errors: [{ message: 'Expected the title not to start with test, which declares it' }]
        },
        {
            name: 'the name of a test for each row of a table',
            code: imported("test.each`a\n${1}`('test $a', ({ a }) => {});"),
            output: imported("test.each`a\n${1}`('$a', ({ a }) => {});"),
            errors: [{ message: 'Expected the title not to start with test, which declares it' }]
        },
        {
            name: 'the name alone',
            code: imported("it('it', () => {});"),
            output: null,
            errors: [{ message: 'Expected the title not to start with it, which declares it' }]
        },
        {
            name: 'the name that a test is imported under',
            code: "import { it as check } from 'hypotes';\ncheck('it works', () => {});",
            output: "import { it as check } from 'hypotes';\ncheck('works', () => {});",
            errors: [{ message: 'Expected the title not to start with it, which declares it' }]
        }
    ]
});

const NO_FUNCTION = 'Expected a title and a function for the describe block';
const PARAMETERS = "Expected the describe block's function to take no parameters";
const RETURNS = "Expected the describe block's function to return nothing";

tester.run('valid-describe-callback', plugin.rules['valid-describe-callback'], {
    valid: [
        imported("describe('a block', () => {});"),
        imported("describe('a block', async () => { await setUp(); });"),
        imported("describe('a block', function () {});"),
        imported("describe('a block', { timeout: 10 }, () => {});"),
        imported("describe('a block', () => {}, 10);"),
        imported("describe.each([1])('a block for %i', value => {});"),
        imported("describe.for([[1]])('a block for %i', ([value]) => {});"),
        imported("describe.each`a\n${1}`('a block for $a', ({ a }) => {});"),
        imported("describe.for`a\n${1}`('a block for $a', row => {});"),
        imported("describe.todo('a block');"),
        imported("describe('a block', { todo: true });"),
        imported("describe('a block', () => { it('returns', () => { return promise; }); });"),
        // Tests take their contexts
        imported("it('a test', context => {});")
    ],
    invalid: [
        {
            name: 'no function',
            code: imported("describe('a block');"),
            errors: [{ message: NO_FUNCTION }]
        },
        {
            name: 'options without a function',
            code: imported("describe('a block', { skip: true });"),
            errors: [{ message: NO_FUNCTION }]
        },
        {
            name: 'a function declared elsewhere',
            code: imported("describe('a block', declareTests);"),
            errors: [{ message: "Expected the describe block's function to be written in place" }]
        },
        {
            name: 'a parameter',
            code: imported("describe('a block', context => {});"),
            errors: [{ message: PARAMETERS }]
        },
        {
            name: 'a parameter, after options',
            code: imported("suite('a suite', { timeout: 10 }, function (done) {});"),
            errors: [{ message: PARAMETERS }]
        },
        {
            name: 'a return statement',
            code: imported("describe('a block', () => { return setUp(); });"),
            errors: [{ message: RETURNS }]
        },
        {
            name: 'a return statement, for each row of a table',
            code: imported(
                "describe.each`a\n${1}`('a block for $a', ({ a }) => { return setUp(a); });"
            ),
            errors: [{ message: RETURNS }]
        },
        {
            name: 'an arrow function that returns a call',
            code: imported("describe('a block', () => it('works', () => {}));"),
            errors: [{ message: RETURNS }]
        }
    ]
});

const CONDITIONAL_TEST =
    'Expected the test to be declared unconditionally, rather than in an if statement: skipIf() and runIf() skip it on a condition';

tester.run('no-conditional-tests', plugin.rules['no-conditional-tests'], {
    valid: [
        imported("it('asserts on a condition', () => { if (enabled) { expect(1).toBe(1); } });"),
        imported("it.skipIf(skipped)('runs on a condition', () => {});"),
        imported("describe('a block', () => { if (enabled) { setUp(); } it('runs', () => {}); });"),
        imported('if (enabled) { setUp(); }')
    ],
    invalid: [
        {
            name: 'a test',
            code: imported("if (enabled) { it('runs', () => {}); }"),
            errors: [{ message: CONDITIONAL_TEST }]
        },
        {
            name: 'a test for each row, in an else block',
            code: imported("if (enabled) {} else { test.each([1])('runs %i', value => {}); }"),
            errors: [{ message: CONDITIONAL_TEST }]
        },
        {
            name: 'a describe block in a describe block',
            code: imported(
                "describe('a block', () => { if (enabled) { describe('another', () => {}); } });"
            ),
            errors: [
                {
                    message:
                        'Expected the describe block to be declared unconditionally, rather than in an if statement: skipIf() and runIf() skip it on a condition'
                }
            ]
        },
        {
            name: 'a test that a function declares',
            code: imported("function declare(): void { if (enabled) { it('runs', () => {}); } }"),
            errors: [{ message: CONDITIONAL_TEST }]
        }
    ]
});

const UNAWAITED = 'Expected the promise whose callback calls expect() to be awaited or returned';

tester.run('valid-expect-in-promise', plugin.rules['valid-expect-in-promise'], {
    valid: [
        imported(
            "it('awaits', async () => { await promise.then(value => { expect(value).toBe(1); }); });"
        ),
        imported(
            "it('returns', () => { return promise.then(value => { expect(value).toBe(1); }); });"
        ),
        imported("it('returns', () => promise.then(value => { expect(value).toBe(1); }));"),
        imported(
            "it('returns the chain', () => { return promise.then(value => { expect(value).toBe(1); }).finally(cleanUp); });"
        ),
        imported(
            "it('awaits a variable', async () => { const checked = promise.then(value => { expect(value).toBe(1); }); await checked; });"
        ),
        imported(
            "it('returns a variable', () => { const checked = promise.catch(error => { expect(error).toBeDefined(); }); return checked; });"
        ),
        imported(
            "it('awaits an assignment', async () => { let checked; checked = promise.then(value => { expect(value).toBe(1); }); await checked; });"
        ),
        imported(
            "it('awaits all', async () => { const first = a.then(value => { expect(value).toBe(1); }); const second = b.then(value => { expect(value).toBe(2); }); await Promise.all([first, second]); });"
        ),
        imported(
            "it('expects it to resolve', async () => { const checked = promise.then(value => { expect(value).toBe(1); }); await expect(checked).resolves.toBeUndefined(); });"
        ),
        imported(
            "it('returns the inner promise', () => { return outer.then(() => inner.then(value => { expect(value).toBe(1); })); });"
        ),
        imported(
            "it('asserts after the promise', () => { promise.then(cleanUp); expect(1).toBe(1); });"
        ),
        imported(
            'function check(promise: Promise<number>): Promise<void> { return promise.then(value => { expect(value).toBe(1); }); }'
        )
    ],
    invalid: [
        {
            name: 'a promise that is neither awaited nor returned',
            code: imported(
                "it('loses it', () => { promise.then(value => { expect(value).toBe(1); }); });"
            ),
            errors: [{ message: UNAWAITED }]
        },
        {
            name: 'a chain that asserts twice',
            code: imported(
                "it('loses it', async () => { promise.then(value => { expect(value).toBe(1); }).catch(error => { expect(error).toBeDefined(); }); });"
            ),
            errors: [{ message: UNAWAITED }]
        },
        {
            name: 'a callback for rejection',
            code: imported(
                "it('loses it', () => { promise.then(undefined, error => { expect(error).toBeDefined(); }); });"
            ),
            errors: [{ message: UNAWAITED }]
        },
        {
            name: 'a variable that is neither awaited nor returned',
            code: imported(
                "it('loses it', () => { const checked = promise.then(value => { expect(value).toBe(1); }); expect(1).toBe(1); });"
            ),
            errors: [{ message: UNAWAITED }]
        },
        {
            name: 'a variable in Promise.all(), which is neither awaited nor returned',
            code: imported(
                "it('loses it', () => { const checked = promise.then(value => { expect(value).toBe(1); }); Promise.all([checked]); });"
            ),
            errors: [{ message: UNAWAITED }]
        },
        {
            name: 'an inner promise that the outer one does not return',
            code: imported(
                "it('loses it', () => { return outer.then(() => { inner.then(value => { expect(value).toBe(1); }); }); });"
            ),
            errors: [{ message: UNAWAITED }]
        },
        {
            name: 'a promise in a function of its own',
            code: imported(
                'function check(promise: Promise<number>): void { promise.then(value => { expect(value).toBe(1); }); }'
            ),
            errors: [{ message: UNAWAITED }]
        }
    ]
});

tester.run('require-to-throw-message', plugin.rules['require-to-throw-message'], {
    valid: [
        imported("expect(run).toThrow('a message');"),
        imported('expect(run).toThrowError(/a message/u);'),
        imported('expect(run).toThrow(TypeError);'),
        imported('expect(run).not.toThrow();'),
        imported('await expect(promise).resolves.not.toThrow();')
    ],
    invalid: [
        {
            name: 'toThrow()',
            code: imported('expect(run).toThrow();'),
            errors: [
                {
                    message:
                        'Expected toThrow() to be given what the error should be, such as its message'
                }
            ]
        },
        {
            name: 'toThrowError() of a rejection',
            code: imported('await expect(promise).rejects.toThrowError();'),
            errors: [
                {
                    message:
                        'Expected toThrowError() to be given what the error should be, such as its message'
                }
            ]
        }
    ]
});

const UNTYPED_MOCK =
    'Expected vi.fn() to be given the type of the function that it mocks, as in vi.fn<() => void>()';

tester.run('require-mock-type-parameters', plugin.rules['require-mock-type-parameters'], {
    valid: [
        imported('const read = vi.fn<() => string>();'),
        imported('const double = vi.fn<(value: number) => number>(value => value * 2);'),
        imported('const double = vi.fn((value: number) => value * 2);'),
        imported('const read = vi.fn(() => 1).mockReturnValue(2);'),
        imported('const parse = vi.fn(parseInt);'),
        imported("vi.spyOn(console, 'log');"),
        { code: imported('const read = vi.fn();'), filename: 'test.js' },
        // A `vi` that isn't hypotes'
        'declare const vi: { fn(): void };\nvi.fn();'
    ],
    invalid: [
        {
            name: 'a mock',
            code: imported('const read = vi.fn();'),
            errors: [{ message: UNTYPED_MOCK }]
        },
        {
            name: 'a mock in a chain',
            code: imported('const read = vi.fn().mockReturnValue(2);'),
            errors: [{ message: UNTYPED_MOCK }]
        },
        {
            name: 'a module of TypeScript',
            code: imported('const read = vi.fn();'),
            filename: 'test.mts',
            errors: [{ message: UNTYPED_MOCK }]
        }
    ]
});

const MOVE = "Move it to the module's top level, after its imports";

/** The message of a call of `vi.${method}()` that isn't hoisted from where it is */
function notHoisted(method: string): string {
    return `Expected vi.${method}() in a statement of its own at the module's top level: it's hoisted above the module's code`;
}

tester.run('hoisted-apis-on-top', plugin.rules['hoisted-apis-on-top'], {
    valid: [
        imported("vi.mock('./module.ts');"),
        imported("vi.unmock('./module.ts');"),
        imported('const mocks = vi.hoisted(() => ({ read: vi.fn<() => string>() }));'),
        imported('const mocks = await vi.hoisted(async () => ({}));'),
        imported('await vi.hoisted(async () => {});'),
        imported("it('mocks', () => { vi.doMock('./module.ts'); });"),
        // A `vi` that isn't hypotes'
        "declare const vi: { mock(path: string): void };\nif (mocking) { vi.mock('./module.ts'); }"
    ],
    invalid: [
        {
            name: 'a mock in an if statement',
            code: imported("if (mocking) { vi.mock('./module.ts'); }"),
            errors: [
                {
                    message: notHoisted('mock'),
                    suggestions: [
                        {
                            desc: MOVE,
                            output: imported("vi.mock('./module.ts');\nif (mocking) {  }")
                        },
                        {
                            desc: "Call vi.doMock(), which runs where it's called",
                            output: imported("if (mocking) { vi.doMock('./module.ts'); }")
                        }
                    ]
                }
            ]
        },
        {
            name: 'an unmock in a test',
            code: imported("it('mocks', () => { vi.unmock('./module.ts'); });"),
            errors: [
                {
                    message: notHoisted('unmock'),
                    suggestions: [
                        {
                            desc: MOVE,
                            output: imported("vi.unmock('./module.ts');\nit('mocks', () => {  });")
                        },
                        {
                            desc: "Call vi.doUnmock(), which runs where it's called",
                            output: imported("it('mocks', () => { vi.doUnmock('./module.ts'); });")
                        }
                    ]
                }
            ]
        },
        {
            name: 'a hoisted factory in a describe block, above the imports',
            code: "describe('a block', () => { vi.hoisted(() => {}); });\nimport { describe, vi } from 'hypotes';",
            errors: [
                {
                    message: notHoisted('hoisted'),
                    suggestions: [
                        {
                            desc: MOVE,
                            output: "describe('a block', () => {  });\nimport { describe, vi } from 'hypotes';\nvi.hoisted(() => {});"
                        }
                    ]
                }
            ]
        },
        {
            name: 'a mock that is awaited',
            code: imported("await vi.mock('./module.ts');"),
            errors: [
                {
                    message: notHoisted('mock'),
                    suggestions: [
                        {
                            desc: "Call vi.doMock(), which runs where it's called",
                            output: imported("await vi.doMock('./module.ts');")
                        }
                    ]
                }
            ]
        },
        {
            name: 'a hoisted factory that is exported',
            code: imported('export const mocks = vi.hoisted(() => ({}));'),
            errors: [{ message: notHoisted('hoisted') }]
        },
        {
            name: 'a hoisted factory that declares another variable too',
            code: imported('const first = 1, mocks = vi.hoisted(() => ({}));'),
            errors: [{ message: notHoisted('hoisted') }]
        }
    ]
});
