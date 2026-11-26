// A test's run, with what Vitest's runner does around a test's function: it
// makes the test the current one, awaits the `.resolves` and `.rejects`
// assertions that the function didn't, checks `expect.assertions()` and
// `expect.hasAssertions()`, fails the test with the errors of its soft
// assertions, passes a test that `fails` if it failed, and runs the
// callbacks of `onTestFinished` and `onTestFailed`.
//
// node:test awaits the test's function, then runs the `afterEach` hooks, and
// then the test's own `after` hooks, so the callbacks run in one of those,
// where Vitest runs them: after the `afterEach` hooks. A test gets that hook
// only once it needs it, which costs a test that doesn't nothing: once a
// callback is added, or once its function or a hook of it leaves a callback
// or a soft error that @vitest/expect added.
//
// Where it differs from Vitest:
//
// - A test fails with one error, which node:test reports, so a test with
//   more than one fails with an AggregateError, whose message has the
//   message of each. A soft assertion's error is a copy of the one that
//   @vitest/expect recorded.
// - node:test has a test's result once its function ends, so `fails` judges
//   the function, its soft assertions, and its counts of assertions. Vitest
//   passes a test that `fails` when an `afterEach` hook or a callback of
//   `onTestFinished` throws too, which fails it here.
// - node:test drops what an `after` hook throws once the test has failed, so
//   an error of a callback isn't reported besides the error of the test's
//   function.
import type { TestContext as NodeTestContext } from 'node:test';
import { inspect } from 'node:util';
import {
    isTestSyntaxError,
    runAs,
    RunningTest,
    type RecordedError,
    type TestCallback,
    type TestContext
} from './current-test.ts';
import { expect } from './expect.ts';
import { hooksOf } from './test-hooks.ts';

type Awaitable<T> = PromiseLike<T> | T;

/** The error that a soft assertion failed with, from its copy */
function restore(recorded: RecordedError): Error {
    const error = new Error(recorded.message);
    error.name = recorded.name ?? error.name;
    error.stack = recorded.stack ?? error.stack;

    return error;
}

/** The name and the message of what was thrown, as a stack starts with them */
function describe(error: unknown): string {
    return error instanceof Error
        ? `${error.name}: ${error.message}`
        : inspect(error);
}

/**
 * What a test fails with, of everything that failed it: the error itself,
 * or one that tells of each in its message, which is all that some of
 * node:test's reporters print
 */
function failureOf(errors: readonly unknown[]): unknown {
    if (errors.length === 1) {
        return errors[0];
    }

    const messages = errors.map(
        (error, index) => `${index + 1}. ${describe(error)}`
    );

    return new AggregateError(
        errors,
        `${errors.length} errors:\n\n${messages.join('\n\n')}`
    );
}

/**
 * The errors of the `.resolves` and `.rejects` assertions that the test's
 * function didn't await, once they settle
 */
async function unawaitedErrors(test: RunningTest): Promise<unknown[]> {
    const results = await Promise.allSettled(test.pendingAssertions());

    return results
        .filter(result => result.status === 'rejected')
        .map(result => result.reason as unknown);
}

/** Calls each callback in turn, as the current test, and gives their errors */
async function callAll(
    test: RunningTest,
    callbacks: readonly TestCallback[]
): Promise<unknown[]> {
    const context = test.context();
    const errors: unknown[] = [];

    for (const callback of callbacks) {
        try {
            // Vitest runs the callbacks one at a time
            await runAs(test, () => callback(context));
        } catch (error) {
            errors.push(error);
        }
    }

    return errors;
}

/**
 * The run of a test, from the first of its hooks, or its function, that
 * node:test runs: the test, as the current one, how its function ended, and
 * the end of the test, once it needs one
 */
class TestRun {
    readonly #context: NodeTestContext;
    readonly #test: RunningTest;

    /** Whether something failed the test, whether or not it `fails` */
    #failed = false;
    /** Whether the test's function threw, so that node:test failed the test */
    #threw = false;
    /** Whether the test has an `after` hook that ends it */
    #ends = false;

    constructor(context: NodeTestContext) {
        this.#context = context;
        this.#test = new RunningTest(context as TestContext, () => {
            this.#endLater();
        });

        // The context has Vitest's members before anything reads them
        Object.assign(context, { expect, ...hooksOf(this.#test) });
    }

    /** Calls a function of the test, such as a hook, as the current test */
    async call<T>(fn: (context: TestContext) => T): Promise<Awaited<T>> {
        const test = this.#test;

        try {
            return await runAs(test, () => fn(test.context()));
        } finally {
            this.#endIfPending();
        }
    }

    /**
     * Runs the test's function as Vitest's runner does. With `fails`, the
     * test passes if it failed, and fails if it didn't, with Vitest's
     * message, or if it failed with a `TestSyntaxError`.
     */
    async run(
        fn: (context: TestContext) => Awaitable<unknown>,
        fails: boolean
    ): Promise<void> {
        if (fails) {
            this.#test.expectFailure();
        }
        const errors = await this.#errorsOf(fn);
        this.#endIfPending();

        this.#failed = errors.length > 0;
        // As in Vitest, a test that `fails` fails with what is wrong with
        // how it's written, such as a snapshot matcher in it
        const misused = fails && errors.some(isTestSyntaxError);
        this.#threw = misused || this.#failed !== fails;
        if (this.#threw) {
            throw this.#failed
                ? failureOf(errors)
                : new Error('Expect test to fail');
        }
    }

    /**
     * Runs the test's function, and what Vitest checks once it returns, and
     * gives what failed the test: the errors of its soft assertions, and then
     * what it threw, or its assertions that rejected unawaited, or the error
     * of its count of assertions
     */
    async #errorsOf(
        fn: (context: TestContext) => Awaitable<unknown>
    ): Promise<unknown[]> {
        const test = this.#test;
        const thrown: unknown[] = [];

        try {
            await runAs(test, () => fn(test.context()));

            thrown.push(...(await unawaitedErrors(test)));
            if (thrown.length === 0) {
                test.checkAssertions();
            }
        } catch (error) {
            thrown.push(error);
        }

        return [...test.takeErrors().map(restore), ...thrown];
    }

    /** Ends the test in an `after` hook, unless it does already */
    #endLater(): void {
        if (!this.#ends) {
            this.#ends = true;
            this.#context.after(() => this.#end());
        }
    }

    /**
     * Ends the test in an `after` hook if it has callbacks to run, or soft
     * errors to fail with, which @vitest/expect may have added itself
     */
    #endIfPending(): void {
        if (this.#test.hasCallbacks() || this.#test.hasErrors()) {
            this.#endLater();
        }
    }

    /**
     * Runs the callbacks of `onTestFinished`, and those of `onTestFailed` if
     * the test failed: in its function, in a hook, by a soft assertion, or in
     * a callback. It throws what failed the test since its function ended.
     */
    async #end(): Promise<void> {
        const test = this.#test;

        test.finish();
        const errors = await callAll(test, test.takeFinished());

        // node:test has failed the test by now if a hook threw, or it timed out
        const hookFailed = !test.context().passed && !this.#threw;
        if (
            this.#failed ||
            hookFailed ||
            errors.length > 0 ||
            test.hasErrors()
        ) {
            errors.push(...(await callAll(test, test.takeFailed())));
        }

        const failures = [...test.takeErrors().map(restore), ...errors];
        if (failures.length > 0) {
            throw failureOf(failures);
        }
    }
}

const runs = new WeakMap<NodeTestContext, TestRun>();

/**
 * The run of the test whose context node:test passes its function and its
 * hooks. From its first use, which may be a `beforeEach` hook, the context
 * has Vitest's members.
 */
function runOf(context: NodeTestContext): TestRun {
    let run = runs.get(context);
    if (run == null) {
        run = new TestRun(context);
        runs.set(context, run);
    }

    return run;
}

/**
 * Calls a function of a test, such as a hook, with the test's context, as
 * the current test
 */
export function callInTest<T>(
    context: NodeTestContext,
    fn: (context: TestContext) => T
): Promise<Awaited<T>> {
    return runOf(context).call(fn);
}

/**
 * Runs a test's function as Vitest's runner does. With `fails`, the test
 * passes if it failed, and fails if it didn't, with Vitest's message.
 */
export function runTest(
    context: NodeTestContext,
    fn: (context: TestContext) => Awaitable<unknown>,
    fails: boolean
): Promise<void> {
    return runOf(context).run(fn, fails);
}
