// Vitest's `expect.poll()`, which calls a function again and again until a
// matcher passes on its value, or a timeout passes. It's Vitest's own, of
// its `vitest` package, without what its runner and its browser mode add to
// it: the trace of a poll, and the matchers that take over the polling.
//
// As `vi.waitFor()`, it waits in real time, while the timers are fake too,
// and then moves the fake clock forward by the interval.
import { chai } from '@vitest/expect';
import { getSafeTimers } from '@vitest/utils/timers';
import type { FakeClock } from './timers.ts';

type Awaitable<T> = PromiseLike<T> | T;

/** How long `expect.poll()` calls its function, and what for */
export interface PollOptions {
    /**
     * The milliseconds between the calls of the function.
     *
     * @default 50
     */
    interval?: number;
    /**
     * The milliseconds after which the assertion fails.
     *
     * @default 1000
     */
    timeout?: number;
    /** What is polled for, which starts the message of the assertion's error */
    message?: string;
}

/** The function that `expect.poll()` calls, with a signal of its timeout */
export type PollFunction<T> = (options: {
    signal: AbortSignal;
}) => Awaitable<T>;

/** A matcher of a chai assertion */
type Matcher = (this: object, ...args: readonly unknown[]) => unknown;

/** The test of an assertion, of which a poll needs only its callbacks */
interface PollTask {
    onFinished?: Array<() => void>;
}

/** The matchers that a poll has no use for, which Vitest rejects by name */
const UNSUPPORTED: ReadonlySet<string> = new Set([
    'matchSnapshot',
    'toMatchSnapshot',
    'toMatchInlineSnapshot',
    'toThrowErrorMatchingSnapshot',
    'toThrowErrorMatchingInlineSnapshot',
    'throws',
    'Throw',
    'throw',
    'toThrow',
    'toThrowError'
]);

/** Gives the error the stack of another, which names where the poll was called */
function withStackOf<T extends Error>(error: T, source: Error): T {
    if (source.stack != null) {
        error.stack = source.stack.replace(source.message, error.message);
    }

    return error;
}

/**
 * The error that ends a poll, with a cause that says that it timed out, what
 * was polled for before its message, and the stack of the poll's call
 */
function timeoutError(
    error: unknown,
    site: Error,
    message: string | undefined
): unknown {
    if (!(error instanceof Error)) {
        return error;
    }

    try {
        error.cause ??= new Error('Matcher did not succeed in time.');
        // A matcher's message may already have the prefix. DOMException's
        // getter-only message stays intact while its stack can still be set.
        if (message && !error.message.startsWith(`${message}: `)) {
            Reflect.set(error, 'message', `${message}: ${error.message}`);
        }
        return withStackOf(error, site);
    } catch {
        // Even a frozen error or a throwing setter must preserve the failure.
        return error;
    }
}

/** Whether the promise settled, with its value, before the other did */
type Raced<T> = { ok: true; value: T } | { ok: false };

function raceWith<T>(
    promise: Promise<T>,
    other: Promise<unknown>
): Promise<Raced<T>> {
    return Promise.race([
        promise.then((value): Raced<T> => ({ ok: true, value })),
        other.then((): Raced<T> => ({ ok: false }))
    ]);
}

/** What a poll calls, and for how long */
interface Poll {
    readonly assertion: object;
    readonly fn: PollFunction<unknown>;
    readonly matcher: Matcher;
    readonly args: readonly unknown[];
    readonly interval: number;
    readonly timeout: number;
    readonly clock: FakeClock;
}

/**
 * Calls the function and the matcher on its value, at each interval, until
 * the matcher passes, and resolves with what it returns. It rejects with the
 * last error of either once the timeout passes.
 */
async function poll(poll: Poll): Promise<unknown> {
    const { assertion, fn, matcher, args, interval, timeout, clock } = poll;
    const { setTimeout, clearTimeout } = getSafeTimers();

    const controller = new AbortController();
    const timedOut = Promise.withResolvers<void>();
    const timer = setTimeout(() => {
        controller.abort();
        timedOut.resolve();
    }, timeout);

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastError: unknown;
    try {
        while (!controller.signal.aborted) {
            try {
                const value = await raceWith(
                    Promise.resolve().then(() =>
                        fn({ signal: controller.signal })
                    ),
                    timedOut.promise
                );
                if (!value.ok) {
                    lastError ??= new Error(
                        "expect.poll() function didn't resolve in time."
                    );
                    break;
                }

                chai.util.flag(assertion, 'object', value.value);
                const result = await raceWith(
                    Promise.resolve().then(() =>
                        matcher.call(assertion, ...args)
                    ),
                    timedOut.promise
                );
                if (!result.ok) {
                    lastError ??= new Error(
                        "expect.poll() assertion didn't resolve in time."
                    );
                    break;
                }

                return result.value;
            } catch (error) {
                lastError = error;

                const retry = Promise.withResolvers<void>();
                retryTimer = setTimeout(retry.resolve, interval);
                const waited = await raceWith(retry.promise, timedOut.promise);
                if (!waited.ok) {
                    break;
                }
                if (clock.isFakeTimers()) {
                    clock.advanceTimersByTime(interval);
                }
            }
        }
    } finally {
        clearTimeout(timer);
        clearTimeout(retryTimer);
    }

    throw lastError;
}

/**
 * `expect.poll()`, of the `expect` whose assertions it polls with. The
 * assertion that it returns has `expect`'s matchers, each of which returns a
 * promise, and polls once that is awaited. An assertion that isn't awaited
 * fails its test when the test ends.
 */
export function createPoll<Assertion extends object>(
    expect: (actual: unknown, message?: string) => Assertion,
    clock: FakeClock
): (fn: PollFunction<unknown>, options?: PollOptions) => Assertion {
    return (fn, options = {}) => {
        const { interval = 50, timeout = 1000, message } = options;

        const assertion = expect(null, message);
        chai.util.flag(assertion, 'poll', true);
        const test = chai.util.flag(assertion, 'vitest-test') as
            | PollTask
            | undefined;
        if (test == null) {
            throw new Error('expect.poll() must be called inside a test');
        }

        /** A matcher that polls with the assertion's, once it's awaited */
        const polling = (name: string, matcher: Matcher) =>
            function (...args: unknown[]): PromiseLike<unknown> {
                const site = new Error('STACK_TRACE_ERROR');

                let awaited = false;
                test.onFinished ??= [];
                test.onFinished.push(() => {
                    if (!awaited) {
                        throw withStackOf(
                            unawaitedError(assertion, name),
                            site
                        );
                    }
                });

                let result: Promise<unknown> | undefined;
                const start = (): Promise<unknown> => {
                    awaited = true;
                    chai.util.flag(assertion, '_name', name);
                    result ??= poll({
                        assertion,
                        fn,
                        matcher,
                        args,
                        interval,
                        timeout,
                        clock
                    }).catch((error: unknown) => {
                        throw timeoutError(error, site, message);
                    });

                    return result;
                };

                // A thenable, rather than a promise, so that only an
                // assertion that is awaited polls
                return {
                    // oxlint-disable-next-line unicorn/no-thenable -- Polls once it's awaited
                    then: (onFulfilled, onRejected) =>
                        start().then(onFulfilled, onRejected),
                    catch: (onRejected: (reason: unknown) => unknown) =>
                        start().catch(onRejected),
                    finally: (onFinally: () => void) =>
                        start().finally(onFinally),
                    [Symbol.toStringTag]: 'Promise'
                } as PromiseLike<unknown>;
            };

        const proxy: Assertion = new Proxy(assertion, {
            get(target, key, receiver) {
                const member: unknown = Reflect.get(target, key, receiver);

                if (typeof member !== 'function') {
                    // A property that chains, such as `not`
                    return member instanceof chai.Assertion ? proxy : member;
                }
                if (typeof key !== 'string' || key === 'assert') {
                    return member;
                }
                if (UNSUPPORTED.has(key)) {
                    throw new SyntaxError(
                        `expect.poll() is not supported in combination with .${key}(). Use vi.waitFor() if your assertion condition is unstable.`
                    );
                }

                return polling(key, member as Matcher);
            }
        });

        return proxy;
    };
}

/** The error of a poll whose promise the test's function didn't await */
function unawaitedError(assertion: object, name: string): Error {
    const negated = chai.util.flag(assertion, 'negate') ? 'not.' : '';
    const call = `expect.poll(assertion).${negated}${name}()`;

    return new Error(
        `${call} was not awaited. This assertion is asynchronous and must be awaited; otherwise, it is not executed to avoid unhandled rejections:\n\nawait ${call}\n`
    );
}
