// Vitest's API for tests, on Node's test runner: tests and suites, hooks,
// Vitest's matchers, its spies, and its module mocks
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
import {
    doMock,
    doUnmock,
    hoisted,
    importActual,
    mock,
    unmock
} from './mocks.ts';

export { expect, type Expect } from './expect.ts';
export {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    type AfterHook,
    type Hook
} from './hooks.ts';
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
export type { MockFactoryWithHelper } from './mocks.ts';
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

/**
 * Vitest's spies, which its matchers, such as `toHaveBeenCalledWith`, check,
 * and its module mocks, which node preloads with `--import hypotes/register`.
 * node:test's `mock` mocks timers.
 */
export const vi = {
    clearAllMocks,
    doMock,
    doUnmock,
    fn,
    hoisted,
    importActual,
    isMockFunction,
    mock,
    mocked,
    resetAllMocks,
    restoreAllMocks,
    spyOn,
    unmock
};
