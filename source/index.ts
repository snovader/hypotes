// Vitest's API for tests, on Node's test runner: tests and suites, hooks,
// the callbacks of a test's end, Vitest's matchers, its snapshots, its spies,
// its module mocks, its fake timers, its stubs of globals, and its waits
import {
    clearAllMocks,
    fn,
    isMockFunction,
    resetAllMocks,
    restoreAllMocks,
    spyOn,
    type MaybeMocked,
    type MaybeMockedDeep,
    type MaybePartiallyMocked,
    type MaybePartiallyMockedDeep
} from '@vitest/spy';
import { chained } from './chain.ts';
import {
    doMock,
    doUnmock,
    hoisted,
    importActual,
    mock,
    unmock
} from './mocks.ts';
import { createStubsAPI, type StubsAPI } from './stubs.ts';
import { createTimersAPI, type TimersAPI } from './timers.ts';
import { createWaitAPI, type WaitAPI } from './wait.ts';

export { expect, type Expect } from './expect.ts';
export {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    type AfterHook,
    type Hook
} from './hooks.ts';
export { onTestFailed, onTestFinished } from './test-hooks.ts';
export {
    describe,
    it,
    suite,
    test,
    type Declare,
    type Each,
    type For,
    type Modifiers,
    type SuiteAPI,
    type SuiteContext,
    type SuiteFunction,
    type TestAPI,
    type TestContext,
    type TestFunction,
    type TestOptions
} from './tests.ts';
export type { TestCallback } from './current-test.ts';
export type { MockFactoryWithHelper } from './mocks.ts';
export type { PollFunction, PollOptions } from './poll.ts';
export type { InlineSnapshotMatcher, SnapshotMatcher } from './snapshot.ts';
export type { SnapshotSerializer } from './snapshot-session.ts';
export type { FakeTimersConfig } from './timers.ts';
export type { Mock, MockInstance } from '@vitest/spy';

/**
 * Returns the value, typed as its mock: a type helper, for what `vi.mock()`
 * or `vi.spyOn()` mocked, as in `vi.mocked(module.fn).mockReturnValue(1)`.
 * With `deep`, its nested functions are typed as mocks too, and with
 * `partial`, their implementations can return part of what they would.
 */
function mocked<T>(item: T, deep?: false): MaybeMocked<T>;
function mocked<T>(item: T, deep: true): MaybeMockedDeep<T>;
function mocked<T>(
    item: T,
    options: { partial?: false; deep?: false }
): MaybeMocked<T>;
function mocked<T>(
    item: T,
    options: { partial?: false; deep: true }
): MaybeMockedDeep<T>;
function mocked<T>(
    item: T,
    options: { partial: true; deep?: false }
): MaybePartiallyMocked<T>;
function mocked<T>(
    item: T,
    options: { partial: true; deep: true }
): MaybePartiallyMockedDeep<T>;
function mocked(item: unknown): unknown {
    return item;
}

/** The members of `vi` that mock functions, objects' methods, and modules */
const mocks = {
    doMock,
    doUnmock,
    fn,
    hoisted,
    importActual,
    isMockFunction,
    mock,
    mocked,
    spyOn,
    unmock
};

/** `vi`, which the members that Vitest's return `vi` from return */
export interface Vi
    extends Readonly<typeof mocks>, StubsAPI<Vi>, TimersAPI<Vi>, WaitAPI {
    /** Clears the calls and results of every mock */
    clearAllMocks(): Vi;
    /** Clears every mock, and resets its implementation to its original */
    resetAllMocks(): Vi;
    /** Restores what every `vi.spyOn()` replaced */
    restoreAllMocks(): Vi;
}

const self = (): Vi => vi;
const timers = createTimersAPI(self);

/**
 * Vitest's spies, which its matchers, such as `toHaveBeenCalledWith`, check,
 * its module mocks, which node preloads with `--import hypotes/register`,
 * its fake timers, its stubs of globals and environment variables, and its
 * waits.
 */
export const vi: Vi = {
    ...mocks,
    clearAllMocks: chained(self, clearAllMocks),
    resetAllMocks: chained(self, resetAllMocks),
    restoreAllMocks: chained(self, restoreAllMocks),
    ...createStubsAPI(self),
    ...timers,
    ...createWaitAPI(timers)
};
