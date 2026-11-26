// Vitest's hooks, through node:test's. A hook declared in a suite runs for
// its tests, and one declared at the top of a file runs for every test in the
// process: a file of its own, unless tests run in one process, with
// `--test-isolation=none`. node:test runs after hooks in the order that they
// were declared, and the cleanup that a before hook returns runs as an after
// hook declared with it, where Vitest runs them in the reverse order.
//
// A hook of each test runs with the test as the current one, so it can call
// what a test's function can, such as `onTestFinished` and `expect.soft`.
import * as nodeTest from 'node:test';
import type { TestContext } from './current-test.ts';
import { callInTest } from './test-run.ts';

type Awaitable<T> = PromiseLike<T> | T;

/** A hook, which can return a function that cleans up after it */
export type Hook<Context> = (
    context: Context
) => Awaitable<(() => Awaitable<unknown>) | void>;

/** A hook, which runs after the tests or each test */
export type AfterHook<Context> = (context: Context) => Awaitable<unknown>;

type HookContext = nodeTest.SuiteContext | nodeTest.TestContext;

/** Runs `cleanup` if a hook returned a function */
async function cleanUp(cleanup: unknown): Promise<void> {
    if (typeof cleanup === 'function') {
        await (cleanup as () => Awaitable<unknown>)();
    }
}

/** Runs the hook before the suite's tests, and its cleanup after them */
export function beforeAll(fn: Hook<HookContext>, timeout?: number): void {
    let cleanup: unknown;

    nodeTest.before(
        async context => {
            cleanup = await fn(context);
        },
        { timeout }
    );
    nodeTest.after(() => cleanUp(cleanup), { timeout });
}

/** Runs the hook after the suite's tests */
export function afterAll(fn: AfterHook<HookContext>, timeout?: number): void {
    nodeTest.after(async context => void (await fn(context)), { timeout });
}

/** Runs the hook before each of the suite's tests, and its cleanup after it */
export function beforeEach(fn: Hook<TestContext>, timeout?: number): void {
    const cleanups = new WeakMap<HookContext, unknown>();

    nodeTest.beforeEach(
        async context => {
            cleanups.set(context, await callEach(context, fn));
        },
        { timeout }
    );
    nodeTest.afterEach(
        context => callEach(context, () => cleanUp(cleanups.get(context))),
        { timeout }
    );
}

/** Runs the hook after each of the suite's tests */
export function afterEach(fn: AfterHook<TestContext>, timeout?: number): void {
    nodeTest.afterEach(async context => void (await callEach(context, fn)), {
        timeout
    });
}

/**
 * Calls a hook of each test with the test's context, which node:test types
 * as a suite's too, as the current test
 */
function callEach<T>(context: HookContext, fn: (context: TestContext) => T): T {
    return callInTest(context as nodeTest.TestContext, fn);
}
