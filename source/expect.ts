// Vitest's matchers, from @vitest/expect, which adds them to chai as plugins,
// on an `expect` with the members of Vitest's that its runner drives too:
// each assertion takes the test that is running, as Vitest's does, which
// @vitest/expect's soft assertions record their errors in.
//
// Where it differs from Vitest:
//
// - The assertions are counted for the test that is running, so
//   `expect.assertions()` and `expect.hasAssertions()` hold for tests that
//   run at once too, where Vitest's count every test's, unless a test takes
//   `expect` from its context. Outside a test, they do nothing.
import { styleText } from 'node:util';
import {
    addCustomEqualityTesters,
    chai,
    customMatchers,
    setState,
    JestAsymmetricMatchers,
    JestChaiExpect,
    JestExtend,
    type Assertion,
    type AsymmetricMatchersContaining,
    type ExpectStatic,
    type MatchersObject,
    type PromisifyAssertion,
    type Tester
} from '@vitest/expect';
import { disableDefaultColors } from 'tinyrainbow';
import { currentTest, type ExpectTask } from './current-test.ts';
import { diffValues } from './diff.ts';
import { fastEquality } from './equals.ts';
import { createPoll, type PollFunction, type PollOptions } from './poll.ts';
import {
    addSnapshotSerializer,
    type SnapshotSerializer
} from './snapshot-session.ts';
import { SnapshotPlugin } from './snapshot.ts';
import { fakeClock } from './timers.ts';

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
chai.use(SnapshotPlugin);
chai.use(JestAsymmetricMatchers);

/**
 * Vitest's `expect`, with its matchers, such as `toStrictEqual`, its
 * asymmetric matchers, such as `expect.any`, `extend` and
 * `addEqualityTesters`, `fail`, which it has from chai's, and the members
 * that ask for the test that is running: `soft`, `poll`, `assertions`, and
 * `hasAssertions`.
 */
export interface Expect
    extends
        AsymmetricMatchersContaining,
        Pick<ExpectStatic, 'any' | 'anything' | 'extend' | 'fail' | 'not'> {
    <T>(actual: T, message?: string): Assertion<void, T>;
    /** Adds testers, which `toEqual` and other matchers try first */
    addEqualityTesters: (testers: Tester[]) => void;
    /**
     * An assertion that doesn't throw where its matcher fails: the test
     * goes on, and fails once it ends, with the error of each. It throws
     * outside a test.
     */
    soft: <T>(actual: T, message?: string) => Assertion<void, T>;
    /**
     * An assertion on what the function returns or resolves with, which
     * calls it until the matcher passes, or the timeout does. Each matcher
     * returns a promise, which a test awaits. It throws outside a test.
     */
    poll: <T>(
        fn: PollFunction<T>,
        options?: PollOptions
    ) => PromisifyAssertion<Awaited<T>>;
    /**
     * Fails the test unless `expect()` is called this many times by the
     * end of its function
     */
    assertions: (expected: number) => void;
    /** Fails the test unless `expect()` is called by the end of its function */
    hasAssertions: () => void;
    /**
     * Adds a serializer, which the snapshots of the process try before
     * those that they have
     */
    addSnapshotSerializer: (serializer: SnapshotSerializer) => void;
}

/** An assertion of chai's, with what @vitest/expect adds for Vitest's runner */
interface ChaiAssertion {
    /** Sets the test that the assertion is made in */
    withTest(test: ExpectTask): ChaiAssertion;
    /** Sets flags of the assertion, such as `soft` */
    withContext(flags: Record<string, unknown>): ChaiAssertion;
}

/** chai's `expect`, whose `extend` takes the `expect` to add matchers to */
interface ChaiExpect {
    (actual: unknown, message?: string): ChaiAssertion;
    extend: (expect: Expect, matchers: MatchersObject) => void;
}

const chaiExpect = chai.expect as unknown as ChaiExpect;

/**
 * An assertion, which the test that is running counts, and which takes that
 * test, as Vitest's do
 */
function assertionOf(actual: unknown, message?: string): ChaiAssertion {
    const assertion = chaiExpect(actual, message);
    const test = currentTest();
    if (test == null) {
        return assertion;
    }

    test.countAssertion();
    return assertion.withTest(test.task());
}

function assertions(expected: number): void {
    currentTest()?.expectAssertions(expected);
}

function hasAssertions(): void {
    const error = new Error('expected any number of assertion, but got none');
    // The stack starts where the test's function called this
    Error.captureStackTrace(error, hasAssertions);

    currentTest()?.expectAnyAssertion(error);
}

export const expect = Object.assign(
    <T>(actual: T, message?: string): Assertion<void, T> =>
        assertionOf(actual, message) as unknown as Assertion<void, T>,
    // The asymmetric matchers, and `not`
    chaiExpect,
    {
        extend: (matchers: MatchersObject): void => {
            chaiExpect.extend(expect, matchers);
        },
        addEqualityTesters: (testers: Tester[]): void => {
            addCustomEqualityTesters(testers);
        },
        soft: (actual: unknown, message?: string): ChaiAssertion =>
            assertionOf(actual, message).withContext({ soft: true }),
        poll: createPoll(assertionOf, fakeClock),
        assertions,
        hasAssertions,
        addSnapshotSerializer
    }
) as unknown as Expect;

// What a matcher of `expect.extend()` reads of the test, as `this.testPath`,
// besides `this.currentTestName`, which @vitest/expect reads of the test
setState(
    {
        get testPath() {
            return currentTest()?.filePath();
        }
    },
    expect as unknown as ExpectStatic
);

// `toSatisfy` and `toBeOneOf`, which Vitest's `expect` adds
expect.extend(customMatchers);
addCustomEqualityTesters([fastEquality]);

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

if (!assert[WITH_DIFF]) {
    const assertWithDiff: Assert = function (this, ...args) {
        try {
            assert.apply(this, args);
        } catch (error) {
            if (error instanceof chai.AssertionError && error.showDiff) {
                const changes = diffValues(error.actual, error.expected);
                if (changes != null) {
                    error.message += `\n\n+ actual - expected\n\n${changes}`;
                }
            }
            throw error;
        }
    };
    assertWithDiff[WITH_DIFF] = true;

    chai.Assertion.prototype.assert = assertWithDiff;
}
