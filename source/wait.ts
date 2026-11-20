// Vitest's `vi.waitFor()` and `vi.waitUntil()`, which call a function again
// and again until it succeeds or a timeout passes.
//
// They wait in real time, while the timers are fake too: @vitest/utils keeps
// the timers as they are when this module loads, as Vitest's runner has it
// keep them when it starts. While the timers are fake, each call moves the
// fake clock forward by the interval first, so that what the function waits
// for can happen.
//
// Where it differs from Vitest:
//
// - Vitest names the wait in its trace timeline, which needs its runner.
// - A wait stops calling the function once it settles. Vitest's
//   `vi.waitUntil()` keeps its interval until the timeout when the function
//   throws or rejects on its first call, and so moves the fake timers of
//   later tests forward.
import { getSafeTimers, setSafeTimers } from '@vitest/utils/timers';

/** How long `vi.waitFor()` and `vi.waitUntil()` wait, and what for */
export interface WaitOptions {
    /**
     * The milliseconds between the calls of the function.
     *
     * @default 50
     */
    interval?: number;
    /**
     * The milliseconds after which the wait fails.
     *
     * @default 1000
     */
    timeout?: number;
    /** What is waited for, which starts the message of the wait's error */
    message?: string;
}

/** What `vi.waitUntil()` resolves with: a value that isn't falsy */
type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T;

/** The members of `vi` that wait for a function to succeed */
export interface WaitAPI {
    /**
     * Calls the function until it returns or resolves, and resolves with
     * its value. It rejects with the function's last error once the timeout
     * passes. A number for the options is the timeout.
     */
    waitFor<T>(
        callback: () => T | Promise<T>,
        options?: number | WaitOptions
    ): Promise<T>;

    /**
     * Calls the function until it returns or resolves with a value that
     * isn't falsy, and resolves with it. It rejects with the function's
     * error at once, or once the timeout passes. A number for the options
     * is the timeout.
     */
    waitUntil<T>(
        callback: () => T | Promise<T>,
        options?: number | WaitOptions
    ): Promise<Truthy<T>>;
}

/** The fake timers, which a wait moves forward while they're in use */
interface FakeClock {
    isFakeTimers(): boolean;
    advanceTimersByTime(ms: number): unknown;
}

/** What tells `vi.waitFor()` from `vi.waitUntil()` */
interface Policy {
    /** The member's name, for the error of its timeout */
    name: string;
    /** Whether a value that the function gives ends the wait */
    accepts(value: unknown): boolean;
    /** Whether the function is called again after it throws or rejects */
    retriesErrors: boolean;
}

const WAIT_FOR: Policy = {
    name: 'waitFor',
    accepts: () => true,
    retriesErrors: true
};
const WAIT_UNTIL: Policy = {
    name: 'waitUntil',
    accepts: Boolean,
    retriesErrors: false
};

setSafeTimers();

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

/** The error, with what was waited for before its message, where it can be */
function prefixMessage(error: unknown, message: string | undefined): unknown {
    if (message === undefined || message === '' || !(error instanceof Error)) {
        return error;
    }

    const original = error.message;
    try {
        error.message = `${message}: ${original}`;
    } catch {
        // The message of some errors is read-only, as a DOMException's
        return error;
    }
    if (error.stack !== undefined) {
        error.stack = error.stack.replace(original, error.message);
    }

    return error;
}

/**
 * Calls the function now, and then at each interval, until the policy
 * accepts a value of it, its error ends the wait, or the timeout passes
 */
function poll<T>(
    callback: () => T | PromiseLike<T>,
    options: number | WaitOptions,
    policy: Policy,
    clock: FakeClock
): Promise<T> {
    const { setTimeout, setInterval, clearTimeout, clearInterval } =
        getSafeTimers();
    const {
        interval = 50,
        timeout = 1000,
        message
    } = typeof options === 'number' ? { timeout: options } : options;
    // Made here, so that its stack names where the wait was called
    const timedOut = new Error(`Timed out in ${policy.name}!`);

    return new Promise<T>((resolve, reject) => {
        let lastError: unknown;
        let pending = false;
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let intervalId: ReturnType<typeof setInterval> | undefined;

        function stop(): void {
            settled = true;
            clearTimeout(timeoutId);
            clearInterval(intervalId);
        }

        function onValue(value: T): void {
            pending = false;
            if (policy.accepts(value)) {
                stop();
                resolve(value);
            }
        }

        function onError(error: unknown): void {
            pending = false;
            if (policy.retriesErrors) {
                lastError = error;
            } else {
                stop();
                // The function's own error, whatever it threw
                // oxlint-disable-next-line typescript/prefer-promise-reject-errors
                reject(prefixMessage(error, message));
            }
        }

        function onTimeout(): void {
            stop();
            // As Vitest does, a falsy error counts as none
            // oxlint-disable-next-line typescript/prefer-nullish-coalescing, typescript/strict-boolean-expressions, typescript/prefer-promise-reject-errors
            reject(prefixMessage(lastError || timedOut, message));
        }

        function check(): void {
            if (clock.isFakeTimers()) {
                clock.advanceTimersByTime(interval);
            }
            // A promise of the function's is still to settle
            if (pending) {
                return;
            }

            try {
                const result = callback();
                if (isThenable(result)) {
                    pending = true;
                    result.then(onValue, onError);
                } else {
                    onValue(result);
                }
            } catch (error) {
                onError(error);
            }
        }

        check();
        if (!settled) {
            timeoutId = setTimeout(onTimeout, timeout);
            intervalId = setInterval(check, interval);
        }
    });
}

/**
 * The members of `vi` that wait, which move the fake timers forward while
 * a test uses them
 */
export function createWaitAPI(clock: FakeClock): WaitAPI {
    return {
        waitFor: (callback, options = {}) =>
            poll(callback, options, WAIT_FOR, clock),
        waitUntil: <T>(
            callback: () => T | Promise<T>,
            options: number | WaitOptions = {}
        ) => poll(callback, options, WAIT_UNTIL, clock) as Promise<Truthy<T>>
    };
}
