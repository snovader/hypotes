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
 * A wait for a function, which calls it now, and then at each interval,
 * until the policy accepts a value of it, its error ends the wait, or the
 * timeout passes
 */
class Wait<T> {
    readonly #callback: () => T | PromiseLike<T>;
    readonly #policy: Policy;
    readonly #clock: FakeClock;

    readonly #interval: number;
    readonly #timeout: number;
    readonly #message: string | undefined;
    /** Made with the wait, so that its stack names where the wait was called */
    readonly #timedOut: Error;

    /** The real timers, which the wait keeps to while the timers are fake */
    readonly #timers = getSafeTimers();
    readonly #result = Promise.withResolvers<T>();

    #lastError: unknown;
    /** Whether a promise of the function's is still to settle */
    #pending = false;
    #settled = false;
    #timeoutId: ReturnType<typeof setTimeout> | undefined;
    #intervalId: ReturnType<typeof setInterval> | undefined;

    constructor(
        callback: () => T | PromiseLike<T>,
        options: number | WaitOptions,
        policy: Policy,
        clock: FakeClock
    ) {
        const {
            interval = 50,
            timeout = 1000,
            message
        } = typeof options === 'number' ? { timeout: options } : options;

        this.#callback = callback;
        this.#policy = policy;
        this.#clock = clock;

        this.#interval = interval;
        this.#timeout = timeout;
        this.#message = message;
        this.#timedOut = new Error(`Timed out in ${policy.name}!`);
    }

    /** Calls the function for the first time, and returns the wait's promise */
    start(): Promise<T> {
        const { setTimeout, setInterval } = this.#timers;
        const { promise, reject } = this.#result;

        try {
            this.#check();
        } catch (error) {
            // A fake timer threw as the clock moved, which ends the wait
            reject(error);
            return promise;
        }

        if (!this.#settled) {
            this.#timeoutId = setTimeout(
                () => this.#onTimeout(),
                this.#timeout
            );
            this.#intervalId = setInterval(() => this.#check(), this.#interval);
        }

        return promise;
    }

    /** Moves the fake timers forward, and calls the function if it's due */
    #check(): void {
        if (this.#clock.isFakeTimers()) {
            this.#clock.advanceTimersByTime(this.#interval);
        }
        if (this.#pending) {
            return;
        }

        try {
            const result = this.#callback();
            if (isThenable(result)) {
                this.#pending = true;
                result.then(
                    value => this.#onValue(value),
                    (error: unknown) => this.#onError(error)
                );
            } else {
                this.#onValue(result);
            }
        } catch (error) {
            this.#onError(error);
        }
    }

    #onValue(value: T): void {
        this.#pending = false;
        if (this.#policy.accepts(value)) {
            this.#stop();
            this.#result.resolve(value);
        }
    }

    #onError(error: unknown): void {
        this.#pending = false;
        if (this.#policy.retriesErrors) {
            this.#lastError = error;
        } else {
            this.#stop();
            // The function's own error, whatever it threw
            this.#result.reject(prefixMessage(error, this.#message));
        }
    }

    #onTimeout(): void {
        this.#stop();
        // As Vitest does, a falsy error counts as none
        // oxlint-disable-next-line typescript/prefer-nullish-coalescing, typescript/strict-boolean-expressions
        const error = this.#lastError || this.#timedOut;

        this.#result.reject(prefixMessage(error, this.#message));
    }

    /** Ends the calls of the function, once the wait has its result */
    #stop(): void {
        const { clearTimeout, clearInterval } = this.#timers;

        this.#settled = true;
        clearTimeout(this.#timeoutId);
        clearInterval(this.#intervalId);
    }
}

/**
 * The members of `vi` that wait, which move the fake timers forward while
 * a test uses them
 */
export function createWaitAPI(clock: FakeClock): WaitAPI {
    return {
        waitFor: (callback, options = {}) =>
            new Wait(callback, options, WAIT_FOR, clock).start(),
        waitUntil: <T>(
            callback: () => T | Promise<T>,
            options: number | WaitOptions = {}
        ) =>
            new Wait(callback, options, WAIT_UNTIL, clock).start() as Promise<
                Truthy<T>
            >
    };
}
