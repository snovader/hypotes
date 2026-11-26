// Vitest's `onTestFinished` and `onTestFailed`, which a test's function, or
// a hook of it, calls to have a callback run once the test ends.
//
// Where they differ from Vitest:
//
// - A callback has a timeout only if it's given one. Vitest gives each its
//   `hookTimeout`, of ten seconds, and aborts the test's signal once it
//   passes.
import { assertTypes } from '@vitest/utils/helpers';
import { getSafeTimers } from '@vitest/utils/timers';
import {
    currentTest,
    type RunningTest,
    type TestCallback
} from './current-test.ts';

/**
 * The callback, which rejects once the timeout passes, in real time, while
 * the timers are fake too
 */
function withTimeout(
    callback: TestCallback,
    timeout: number | undefined
): TestCallback {
    if (timeout == null) {
        return callback;
    }

    return async context => {
        const { setTimeout, clearTimeout } = getSafeTimers();
        const timedOut = Promise.withResolvers<never>();
        const timer = setTimeout(() => {
            timedOut.reject(
                new Error(
                    `Hook timed out in ${timeout}ms.\nIf this is a long-running hook, pass a timeout value as the last argument.`
                )
            );
        }, timeout);

        try {
            await Promise.race([callback(context), timedOut.promise]);
        } finally {
            clearTimeout(timer);
        }
    };
}

type Name = 'onTestFinished' | 'onTestFailed';

/** The test that is running, or Vitest's errors where none is */
function testFor(name: Name, callback: unknown): RunningTest {
    assertTypes(callback, `"${name}" callback`, ['function']);
    const test = currentTest();
    if (test == null) {
        throw new Error(`Hook ${name}() can only be called inside a test`);
    }

    return test;
}

/**
 * Runs the callback once the test that is running ends, whether it passed
 * or failed: after its `afterEach` hooks, and before the callbacks that were
 * added earlier. Its error fails the test. It throws outside a test.
 */
export function onTestFinished(callback: TestCallback, timeout?: number): void {
    testFor('onTestFinished', callback).onFinished(
        withTimeout(callback, timeout)
    );
}

/**
 * Runs the callback once the test that is running ends, if it failed: after
 * the callbacks of `onTestFinished`, and before the callbacks that were
 * added earlier. It throws outside a test.
 */
export function onTestFailed(callback: TestCallback, timeout?: number): void {
    testFor('onTestFailed', callback).onFailed(withTimeout(callback, timeout));
}

/**
 * The test, for its context's member, which throws, as Vitest's does, once
 * the callbacks of the test's end run. The functions that the package
 * exports don't throw then, as Vitest's don't.
 */
function testOfContext(test: RunningTest, name: Name): RunningTest {
    if (test.isFinishing()) {
        throw new Error(`Cannot call "${name}" inside a test hook.`);
    }

    return test;
}

/** `onTestFinished` and `onTestFailed` of one test, for its context */
export function hooksOf(test: RunningTest): {
    onTestFinished: typeof onTestFinished;
    onTestFailed: typeof onTestFailed;
} {
    return {
        onTestFinished: (callback, timeout) => {
            testOfContext(test, 'onTestFinished').onFinished(
                withTimeout(callback, timeout)
            );
        },
        onTestFailed: (callback, timeout) => {
            testOfContext(test, 'onTestFailed').onFailed(
                withTimeout(callback, timeout)
            );
        }
    };
}
