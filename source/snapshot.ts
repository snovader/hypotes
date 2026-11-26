// Vitest's snapshot matchers: `toMatchSnapshot`, `toMatchInlineSnapshot`,
// `toMatchFileSnapshot`, `toThrowErrorMatchingSnapshot`, and
// `toThrowErrorMatchingInlineSnapshot`. They're the chai plugin of the
// `vitest` package, which no `@vitest/*` package has, on @vitest/snapshot,
// which `snapshot-session.ts` loads once a matcher is called: so the
// snapshots are Vitest's, to the byte, and a test file's pass in both.
//
// @vitest/snapshot finds where an inline snapshot is written from the stack
// of the matcher's call, by the name of the matcher's function here, and
// by the frames between it and the test file's: this function,
// @vitest/expect's wrapper, and chai's. Node strips a test file's types in
// place, and maps the stack of a module that `hypotes/register` transforms,
// so the position is the one in the file as it's written.
//
// Where it differs from Vitest:
//
// - A matcher takes the test that is running, where Vitest's global `expect`
//   takes the test that started last: so tests that run at once match their
//   own snapshots, which Vitest's do only through their context's `expect`.
// - A hook before the function of a test that `fails` can call a snapshot
//   matcher, which throws in Vitest: only the function knows that it fails.
// - node:test's reporters print no diff, so the message of a mismatch
//   carries one, as other matchers' do.
// - It leaves out `Snapshots`, which builds custom snapshot matchers, and
//   with it the snapshots of a custom domain, which `expect.poll()` polls.
import {
    chai,
    createAssertionMessage,
    recordAsyncExpect,
    wrapAssertion,
    type ChaiPlugin
} from '@vitest/expect';
import type { MatchResult } from '@vitest/snapshot';
import {
    currentTest,
    TestSyntaxError,
    type RunningTest
} from './current-test.ts';
import { diffLines, diffValues } from './diff.ts';
import {
    snapshotClient,
    stripSnapshotIndentation
} from './snapshot-session.ts';

/** `toMatchSnapshot`, with properties that the value has to match, or without */
export interface SnapshotMatcher<R, T> {
    <U extends { [P in keyof T]: unknown }>(
        properties: Partial<U>,
        hint?: string
    ): R;
    (hint?: string): R;
}

/** `toMatchInlineSnapshot`, with properties, or with the snapshot alone */
export interface InlineSnapshotMatcher<R, T> {
    <U extends { [P in keyof T]: unknown }>(
        properties: Partial<U>,
        snapshot?: string,
        hint?: string
    ): R;
    (snapshot?: string, hint?: string): R;
}

declare module '@vitest/expect' {
    interface Assertion<R extends void | Promise<void> = void, T = unknown> {
        /**
         * Compares the value, serialized, to its snapshot in
         * `__snapshots__/<test file>.snap`, which is written if it has
         * none. With properties, the value has to match them, and they
         * take the place of the value's in the snapshot. A hint names the
         * snapshot, besides the test's name.
         */
        toMatchSnapshot: SnapshotMatcher<R, T>;
        /** As `toMatchSnapshot`, which it was called in Jest's first versions */
        matchSnapshot: SnapshotMatcher<R, T>;
        /**
         * Compares the value, serialized, to the snapshot that it's given,
         * which is written into the test file if it's given none
         */
        toMatchInlineSnapshot: InlineSnapshotMatcher<R, T>;
        /**
         * Compares the value to the content of the file, whose path is
         * relative to the test file. A string is compared as it is, and
         * another value serialized. It returns a promise, which a test
         * awaits.
         */
        toMatchFileSnapshot: (filepath: string, hint?: string) => Promise<void>;
        /** Compares the error that the function throws, serialized, to its snapshot */
        toThrowErrorMatchingSnapshot: (hint?: string) => R;
        /** Compares the error that the function throws to the snapshot that it's given */
        toThrowErrorMatchingInlineSnapshot: (
            snapshot?: string,
            hint?: string
        ) => R;
    }
}

type ChaiAssertion = Parameters<typeof createAssertionMessage>[1];

/** Reads a flag of a chai assertion, or sets it, if given a value */
function flag(assertion: object, key: string, value?: unknown): unknown {
    return value === undefined
        ? chai.util.flag(assertion, key)
        : chai.util.flag(assertion, key, value);
}

/** The name of the matcher that the assertion is calling */
function nameOf(assertion: object): string {
    return flag(assertion, '_name') as string;
}

/** Throws Vitest's error for a snapshot matcher after `.not` */
function refuseNot(assertion: object): void {
    if (flag(assertion, 'negate')) {
        throw new Error(`${nameOf(assertion)} cannot be used with "not"`);
    }
}

/**
 * The test that is running, for a snapshot matcher, which throws Vitest's
 * errors after `.not`, outside a test, and in a test that `fails`
 */
function testFor(assertion: object): RunningTest {
    const name = nameOf(assertion);
    refuseNot(assertion);

    const test = currentTest();
    if (test == null) {
        throw new Error(`'${name}' cannot be used without test context`);
    }
    if (test.expectsFailure()) {
        throw new TestSyntaxError(`'${name}' cannot be used with 'test.fails'`);
    }

    return test;
}

/** The test file of the test, whose snapshots are kept by its path */
function fileOf(test: RunningTest): string {
    const file = test.filePath();
    if (!file) {
        throw new Error('Snapshot cannot be used outside of test');
    }

    return file;
}

/**
 * What the function throws, or the value itself after `.rejects`, as
 * Vitest's `toThrowErrorMatchingSnapshot` takes it
 */
function thrownBy(assertion: object): unknown {
    const received: unknown = flag(assertion, 'object');
    if (typeof received !== 'function') {
        if (!flag(assertion, 'promise')) {
            throw new Error(
                `expected must be a function, received ${typeof received}`
            );
        }
        return received;
    }

    try {
        (received as () => unknown)();
    } catch (error) {
        return error;
    }
    throw new Error("snapshot function didn't throw");
}

/** What a snapshot matcher was called with, besides the value */
interface SnapshotArguments {
    readonly properties?: object;
    readonly inlineSnapshot?: string;
    readonly hint?: string;
}

/** The arguments of `toMatchSnapshot(propertiesOrHint?, hint?)` */
function matchArguments(
    propertiesOrHint: unknown,
    hint: string | undefined
): SnapshotArguments {
    if (typeof propertiesOrHint === 'string') {
        return { hint: propertiesOrHint };
    }

    return { properties: propertiesOrHint as object | undefined, hint };
}

/**
 * The arguments of
 * `toMatchInlineSnapshot(propertiesOrSnapshot?, snapshotOrHint?, hint?)`,
 * with the snapshot as it was before the test file indented it
 */
function inlineArguments(
    propertiesOrSnapshot: unknown,
    snapshotOrHint: string | undefined,
    hint: string | undefined
): SnapshotArguments {
    if (typeof propertiesOrSnapshot === 'string') {
        return {
            inlineSnapshot: stripSnapshotIndentation(propertiesOrSnapshot),
            hint: snapshotOrHint
        };
    }

    return {
        properties: propertiesOrSnapshot as object | undefined,
        // As in Vitest, an empty snapshot is one that is still to be written
        inlineSnapshot: snapshotOrHint
            ? stripSnapshotIndentation(snapshotOrHint)
            : undefined,
        hint
    };
}

/**
 * Compares a value to its snapshot in the test file's, or to the inline
 * one, for the test that is running
 */
function match(
    assertion: object,
    received: unknown,
    isInline: boolean,
    { properties, inlineSnapshot, hint }: SnapshotArguments
): MatchResult {
    const test = testFor(assertion);
    const file = fileOf(test);

    return snapshotClient(file).match({
        received,
        properties,
        message: hint,
        isInline,
        inlineSnapshot,
        assertionName: nameOf(assertion),
        // A `.resolves` or a `.rejects` sets the error of where it was called
        error: flag(assertion, 'error') as Error | undefined,
        filepath: file,
        name: test.fullName()
    });
}

/** Compares a value to the content of a file, for the test that is running */
async function matchFile(
    assertion: object,
    path: string,
    hint: string | undefined
): Promise<MatchResult> {
    const test = testFor(assertion);
    const file = fileOf(test);
    const client = snapshotClient(file);
    const { environment } = client.getSnapshotState(file);

    const snapshotFile = await environment.resolveRawPath(file, path);
    const content = await environment.readSnapshotFile(snapshotFile);

    return client.match({
        received: flag(assertion, 'object'),
        message: hint,
        rawSnapshot: { file: snapshotFile, content: content ?? undefined },
        assertionName: nameOf(assertion),
        filepath: file,
        name: test.fullName()
    });
}

/** Throws unless the value matches the content of the file */
async function assertFileMatched(
    assertion: object,
    path: string,
    hint: string | undefined
): Promise<void> {
    assertMatched(assertion, await matchFile(assertion, path, hint));
}

/**
 * The lines by which a value differs from its snapshot: both are text,
 * unless the value didn't match the properties, or has no snapshot
 */
function describeMismatch(
    actual: unknown,
    expected: unknown
): string | undefined {
    if (typeof actual !== 'string') {
        return diffValues(actual, expected);
    }

    const expectedLines =
        typeof expected === 'string' ? expected.split('\n') : [];
    return diffLines(actual.split('\n'), expectedLines);
}

/**
 * Throws unless the value matched, with Vitest's message, after the
 * assertion's own, and the lines that differ
 */
function assertMatched(assertion: object, result: MatchResult): void {
    if (result.pass) {
        return;
    }

    const { actual, expected } = result;
    const custom = flag(assertion, 'message') as string | undefined;
    const message = (custom ? `${custom}: ` : '') + result.message();
    const changes = describeMismatch(actual, expected);

    throw Object.assign(
        new Error(
            changes == null
                ? message
                : `${message}\n\n+ actual - expected\n\n${changes}`
        ),
        { actual, expected }
    );
}

/** Adds Vitest's snapshot matchers to chai's assertions */
export const SnapshotPlugin: ChaiPlugin = (_, utils) => {
    const { Assertion } = chai;
    const define = (
        name: string,
        matcher: (this: ChaiAssertion, ...args: never[]) => unknown
    ): void => {
        utils.addMethod(
            Assertion.prototype,
            name,
            wrapAssertion(utils, name, matcher as never)
        );
    };

    for (const name of ['matchSnapshot', 'toMatchSnapshot']) {
        define(name, function (propertiesOrHint?: unknown, hint?: string) {
            const args = matchArguments(propertiesOrHint, hint);
            const received: unknown = flag(this, 'object');

            assertMatched(this, match(this, received, false, args));
        });
    }

    define(
        'toMatchInlineSnapshot',
        // @vitest/snapshot reads the name: the test file's frame is the
        // third from this function's
        function __INLINE_SNAPSHOT_OFFSET_3__(
            propertiesOrSnapshot?: unknown,
            snapshotOrHint?: string,
            hint?: string
        ) {
            const args = inlineArguments(
                propertiesOrSnapshot,
                snapshotOrHint,
                hint
            );
            const received: unknown = flag(this, 'object');

            assertMatched(this, match(this, received, true, args));
        }
    );

    define(
        'toThrowErrorMatchingSnapshot',
        function (propertiesOrHint?: unknown, hint?: string) {
            refuseNot(this);
            const args = matchArguments(propertiesOrHint, hint);

            assertMatched(this, match(this, thrownBy(this), false, args));
        }
    );

    define(
        'toThrowErrorMatchingInlineSnapshot',
        function __INLINE_SNAPSHOT_OFFSET_3__(
            snapshotOrHint?: string,
            hint?: string
        ) {
            refuseNot(this);
            const args = inlineArguments(undefined, snapshotOrHint, hint);

            assertMatched(this, match(this, thrownBy(this), true, args));
        }
    );

    // It returns a promise, so @vitest/expect's wrapper, which names the
    // matcher and records a soft assertion's error, isn't around it
    utils.addMethod(
        Assertion.prototype,
        'toMatchFileSnapshot',
        function (this: ChaiAssertion, path: string, hint?: string) {
            flag(this, '_name', 'toMatchFileSnapshot');
            const test = testFor(this);

            const matched = assertFileMatched(this, path, hint);
            // A `.resolves` or a `.rejects` records a soft assertion's itself
            const isSoft =
                Boolean(flag(this, 'soft')) && !flag(this, 'promise');

            return recordAsyncExpect(
                test.task(),
                matched,
                createAssertionMessage(utils, this, true),
                new Error('resolves'),
                isSoft
            );
        }
    );
};
