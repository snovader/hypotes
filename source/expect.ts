// Vitest's matchers, from @vitest/expect, which adds them to chai as plugins,
// on an `expect` of the members of Vitest's that don't need its runner
import { diff, inspect, styleText, type InspectOptions } from 'node:util';
import {
    addCustomEqualityTesters,
    chai,
    customMatchers,
    JestAsymmetricMatchers,
    JestChaiExpect,
    JestExtend,
    type Assertion,
    type AsymmetricMatchersContaining,
    type ExpectStatic,
    type MatchersObject,
    type Tester
} from '@vitest/expect';
import { disableDefaultColors } from 'tinyrainbow';
import { fastEquality } from './equals.ts';

// @vitest/expect colours the messages of its spies' matchers with
// tinyrainbow, which takes colours as wanted unless NO_COLOR says otherwise:
// Vitest's runner decides for it. node:test's reporters print a message as it
// is, to a file too, so the messages have colours only where Node prints
// them: to a terminal, or with FORCE_COLOR, which node:test sets for the
// process of a test file whose results go to one. `styleText` leaves its text
// as it is where Node doesn't.
if (styleText('red', 'text') === 'text') {
    disableDefaultColors();
}

chai.use(JestExtend);
chai.use(JestChaiExpect);
chai.use(JestAsymmetricMatchers);

/**
 * Vitest's `expect`, with its matchers, such as `toStrictEqual`, its
 * asymmetric matchers, such as `expect.any`, and `extend` and
 * `addEqualityTesters`. The members that need Vitest's runner, such as
 * `expect.soft` and `expect.assertions`, aren't here.
 */
export interface Expect
    extends
        AsymmetricMatchersContaining,
        Pick<ExpectStatic, 'any' | 'anything' | 'extend' | 'not'> {
    <T>(actual: T, message?: string): Assertion<void, T>;
    /** Adds testers, which `toEqual` and other matchers try first */
    addEqualityTesters: (testers: Tester[]) => void;
}

/** chai's `expect`, whose `extend` takes the `expect` to add matchers to */
interface ChaiExpect {
    (actual: unknown, message?: string): unknown;
    extend: (expect: Expect, matchers: MatchersObject) => void;
}

const chaiExpect = chai.expect as unknown as ChaiExpect;

export const expect = Object.assign(
    <T>(actual: T, message?: string): Assertion<void, T> =>
        chaiExpect(actual, message) as Assertion<void, T>,
    // The asymmetric matchers, and `not`
    chaiExpect,
    {
        extend: (matchers: MatchersObject): void => {
            chaiExpect.extend(expect, matchers);
        },
        addEqualityTesters: (testers: Tester[]): void => {
            addCustomEqualityTesters(testers);
        }
    }
) as unknown as Expect;

// `toSatisfy` and `toBeOneOf`, which Vitest's `expect` adds
expect.extend(customMatchers);
addCustomEqualityTesters([fastEquality]);

const INSPECT_OPTIONS: InspectOptions = {
    depth: Infinity,
    maxArrayLength: Infinity,
    maxStringLength: Infinity,
    sorted: true
};

/** Unchanged lines kept around each change */
const CONTEXT = 3;

/**
 * The lines of each value that are compared, from the first that differs:
 * comparing takes time that grows with their number times the number that
 * differ, which is seconds for tens of thousands of lines
 */
const MAX_LINES = 1000;

const OMITTED = '  ...';

/**
 * The lines of two values' inspections that differ, with some around them,
 * or undefined if none does
 */
function describeDiff(actual: unknown, expected: unknown): string | undefined {
    const actualLines = inspect(actual, INSPECT_OPTIONS).split('\n');
    const expectedLines = inspect(expected, INSPECT_OPTIONS).split('\n');

    // The lines that both start and end with are the same in both
    const start = commonStart(actualLines, expectedLines);
    const end = commonEnd(actualLines, expectedLines, start);
    if (start + end === Math.max(actualLines.length, expectedLines.length)) {
        return undefined;
    }

    const from = Math.max(0, start - CONTEXT);
    const actualTo = Math.min(
        actualLines.length - end + CONTEXT,
        from + MAX_LINES
    );
    const expectedTo = Math.min(
        expectedLines.length - end + CONTEXT,
        from + MAX_LINES
    );
    const changes = diff(
        actualLines.slice(from, actualTo),
        expectedLines.slice(from, expectedTo)
    );
    const hasAfter =
        actualTo < actualLines.length || expectedTo < expectedLines.length;

    return describeChanges(changes, from > 0, hasAfter);
}

/** How many lines both start with */
function commonStart(a: readonly string[], b: readonly string[]): number {
    const length = Math.min(a.length, b.length);
    let count = 0;
    while (count < length && a[count] === b[count]) {
        count++;
    }

    return count;
}

/** How many lines both end with, after the `start` that both start with */
function commonEnd(
    a: readonly string[],
    b: readonly string[],
    start: number
): number {
    const length = Math.min(a.length, b.length) - start;
    let count = 0;
    while (count < length && a.at(-1 - count) === b.at(-1 - count)) {
        count++;
    }

    return count;
}

/**
 * The changed lines, each marked as the actual value's or the expected
 * one's, with the unchanged lines around them, and a mark where others are
 * left out: between them, and before and after, if there are any
 */
function describeChanges(
    changes: ReturnType<typeof diff>,
    hasBefore: boolean,
    hasAfter: boolean
): string {
    const changed = changes.map(([operation]) => operation !== 0);
    const nearChange = (index: number): boolean =>
        changed
            .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
            .includes(true);

    const lines: string[] = hasBefore ? [OMITTED] : [];
    for (const [index, [operation, line]] of changes.entries()) {
        if (nearChange(index)) {
            lines.push(
                `${operation === 1 ? '+' : operation === -1 ? '-' : ' '} ${line}`
            );
        } else if (lines.at(-1) !== OMITTED) {
            lines.push(OMITTED);
        }
    }
    if (hasAfter && lines.at(-1) !== OMITTED) {
        lines.push(OMITTED);
    }

    return lines.join('\n');
}

// node:test's reporters print an assertion error's message and values, but
// not the diff of the values that Vitest's reporter prints, so the message of
// each failed matcher that compares values carries one
/** Marks chai's `assert` once it adds diffs, if another copy of this module loads */
const WITH_DIFF = Symbol.for('hypotes.withDiff');

type Assert = ((this: Chai.AssertionStatic, ...args: unknown[]) => void) & {
    [WITH_DIFF]?: true;
};

// oxlint-disable-next-line typescript/unbound-method -- Called with each assertion as `this`
const assert = chai.Assertion.prototype.assert as unknown as Assert;

if (assert[WITH_DIFF] !== true) {
    const assertWithDiff: Assert = function (this, ...args) {
        try {
            assert.apply(this, args);
        } catch (error) {
            if (
                error instanceof chai.AssertionError &&
                error.showDiff === true
            ) {
                const changes = describeDiff(error.actual, error.expected);
                if (changes !== undefined) {
                    error.message += `\n\n+ actual - expected\n\n${changes}`;
                }
            }
            throw error;
        }
    };
    assertWithDiff[WITH_DIFF] = true;

    chai.Assertion.prototype.assert = assertWithDiff;
}
