// The test that is running, which the members of Vitest's API that its
// runner drives ask for: `expect.soft`, `expect.poll`, `expect.assertions`,
// `expect.hasAssertions`, `onTestFinished`, and `onTestFailed`.
//
// A test is the current one in the code that its function, its hooks, and
// its callbacks run, and in what they start, through an AsyncLocalStorage:
// so tests that run at once each have their own. Vitest keeps the test that
// started last, for which its global `expect` counts the assertions of every
// test that runs at once, and its `expect.soft` throws after an `await` in
// them.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TestContext as NodeTestContext } from 'node:test';
import type { Expect } from './expect.ts';

type Awaitable<T> = PromiseLike<T> | T;

/** What runs once a test ends, with its context */
export type TestCallback = (context: TestContext) => Awaitable<unknown>;

/**
 * What a test's function and its hooks take: node:test's context, with the
 * members of Vitest's that don't take the place of one of node:test's. Its
 * `signal` is node:test's, which aborts as Vitest's does, and its `skip` is
 * node:test's too, which marks the test as skipped, but returns, where
 * Vitest's throws to end the test.
 */
export interface TestContext extends NodeTestContext {
    /** `expect`, as the package exports it: it knows the test that runs */
    readonly expect: Expect;
    /** `onTestFinished`, for this test */
    readonly onTestFinished: (callback: TestCallback, timeout?: number) => void;
    /** `onTestFailed`, for this test */
    readonly onTestFailed: (callback: TestCallback, timeout?: number) => void;
}

/**
 * An error as @vitest/expect records it: a copy, of the fields that it could
 * serialize
 */
export interface RecordedError {
    readonly message: string;
    readonly name?: string;
    readonly stack?: string;
}

interface ExpectResult {
    state: string;
    errors?: RecordedError[];
}

/**
 * A test as @vitest/expect's assertions take it, with the fields of Vitest's
 * that they read and write: a soft assertion records its error in `result`,
 * a `.resolves` or a `.rejects` its promise in `promises`, and each its check
 * that it was awaited in `onFinished`.
 */
export class ExpectTask {
    readonly type = 'test';
    readonly name: string;
    /** The names of its suites and its own, joined by ' > ' */
    readonly fullTestName: string;
    promises?: Array<Promise<unknown>>;
    onFailed?: TestCallback[];

    readonly #onPending: () => void;
    #result: ExpectResult | undefined;
    #onFinished: TestCallback[] | undefined;

    constructor(context: TestContext, onPending: () => void) {
        this.name = context.name;
        this.fullTestName = context.fullName;
        this.#onPending = onPending;
    }

    // @vitest/expect writes these fields directly, including from native
    // t.after hooks that run after the test function has returned.
    get result(): ExpectResult | undefined {
        return this.#result;
    }

    set result(result) {
        this.#result = result;
        if (result != null) {
            this.#onPending();
        }
    }

    get onFinished(): TestCallback[] | undefined {
        return this.#onFinished;
    }

    set onFinished(callbacks) {
        this.#onFinished = callbacks;
        if (callbacks != null) {
            this.#onPending();
        }
    }
}

/** A test that node:test runs, and what its function has asked of its end */
export class RunningTest {
    readonly #context: TestContext;
    readonly #task: ExpectTask;
    /** Schedules the test's remaining teardown work */
    readonly #onPending: () => void;

    #assertionCalls = 0;
    #expectedAssertions: number | undefined;
    /** The error of `expect.hasAssertions()`, once it's called */
    #withoutAssertions: Error | undefined;
    /** Whether the callbacks of the test's end are running */
    #finishing = false;

    /**
     * The test of node:test's context, which schedules teardown when a
     * callback is registered or a soft assertion records an error
     */
    constructor(context: TestContext, onPending: () => void) {
        this.#context = context;
        this.#onPending = onPending;
        this.#task = new ExpectTask(context, onPending);
    }

    /** node:test's context of the test */
    context(): TestContext {
        return this.#context;
    }

    name(): string {
        return this.#context.name;
    }

    /** The names of the test's suites and its own, joined by ' > ' */
    fullName(): string {
        return this.#context.fullName;
    }

    /** The path of the file that node:test runs the test from */
    filePath(): string | undefined {
        return this.#context.filePath;
    }

    /** The test as @vitest/expect's assertions take it */
    task(): ExpectTask {
        return this.#task;
    }

    /** Counts a call of `expect()` */
    countAssertion(): void {
        this.#assertionCalls++;
    }

    /** Expects `count` calls of `expect()` by the end of the test's function */
    expectAssertions(count: number): void {
        this.#expectedAssertions = count;
    }

    /** Expects a call of `expect()`, with the error to throw without one */
    expectAnyAssertion(error: Error): void {
        this.#withoutAssertions = error;
    }

    /**
     * Throws unless `expect()` was called as many times as the test's
     * function expected, with Vitest's messages
     */
    checkAssertions(): void {
        const calls = this.#assertionCalls;
        const expected = this.#expectedAssertions;

        if (expected != null && calls !== expected) {
            throw new Error(
                `expected number of assertions to be ${expected}, but got ${calls}`
            );
        }
        if (this.#withoutAssertions != null && calls === 0) {
            throw this.#withoutAssertions;
        }
    }

    /** Marks when the callbacks of the test are running */
    setFinishing(finishing: boolean): void {
        this.#finishing = finishing;
    }

    /** Whether the callbacks of the test are running */
    isFinishing(): boolean {
        return this.#finishing;
    }

    /** Runs the callback once the test ends, before those added earlier */
    onFinished(callback: TestCallback): void {
        this.#task.onFinished ??= [];
        this.#task.onFinished.push(callback);
    }

    /** Runs the callback once the test ends, if it failed */
    onFailed(callback: TestCallback): void {
        this.#task.onFailed ??= [];
        this.#task.onFailed.push(callback);
        this.#onPending();
    }

    /** The callbacks to run now that the test ended, last added first */
    takeFinished(): TestCallback[] {
        const callbacks = this.#task.onFinished ?? [];
        this.#task.onFinished = undefined;

        return callbacks.reverse();
    }

    /** The callbacks to run now that the test failed, last added first */
    takeFailed(): TestCallback[] {
        const callbacks = this.#task.onFailed ?? [];
        this.#task.onFailed = undefined;

        return callbacks.reverse();
    }

    /** Whether a soft assertion failed since its errors were last taken */
    hasErrors(): boolean {
        return Boolean(this.#task.result?.errors?.length);
    }

    /** The errors of the soft assertions that failed since they were last taken */
    takeErrors(): RecordedError[] {
        const errors = this.#task.result?.errors ?? [];
        this.#task.result = undefined;

        return errors;
    }

    /**
     * The promises of the `.resolves` and `.rejects` assertions that are
     * still to settle, which the test's function may not have awaited
     */
    pendingAssertions(): ReadonlyArray<Promise<unknown>> {
        return this.#task.promises ?? [];
    }
}

const storage = new AsyncLocalStorage<RunningTest>();

/** The test whose function, hook, or callback is running, if one is */
export function currentTest(): RunningTest | undefined {
    return storage.getStore();
}

/** Calls the function with the test as the current one */
export function runAs<T>(test: RunningTest, fn: () => T): T {
    return storage.run(test, fn);
}
