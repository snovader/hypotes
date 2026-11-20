import { afterEach, describe, expect, it, vi } from 'hypotes';
import { fc, it as property } from 'hypotes/fast-check';

/** A function that throws until it's called for the given time */
function succeedsAt<T>(call: number, value: T): () => T {
    let calls = 0;

    return () => {
        calls++;
        if (calls < call) {
            throw new Error(`call ${calls}`);
        }

        return value;
    };
}

/** The error that a promise rejects with */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('The promise resolved');
}

afterEach(() => {
    vi.useRealTimers();
});

describe('vi.waitFor', () => {
    property.prop([fc.integer({ min: 1, max: 4 }), fc.anything()], { numRuns: 20 })(
        'should call the function until it returns, and resolve with its value',
        async (call, value) => {
            const callback = vi.fn<() => unknown>(succeedsAt(call, value));

            const result: unknown = await vi.waitFor(callback, { interval: 1 });

            expect(Object.is(result, value)).toBe(true);
            expect(callback).toHaveBeenCalledTimes(call);
        }
    );

    it('should call the function again once its promise rejects, and resolve with what it resolves', async () => {
        const callback = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error('first'))
            .mockResolvedValue('second');

        await expect(vi.waitFor(callback, { interval: 1 })).resolves.toBe('second');
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it("should reject with the function's last error once the timeout passes", async () => {
        const error = await rejectionOf(
            vi.waitFor(succeedsAt(Infinity, 'never'), { interval: 1, timeout: 20 })
        );

        expect(String(error)).toMatch(/^Error: call \d+$/u);
    });

    it('should reject with a timeout of its own while a promise is still to settle', async () => {
        const never = Promise.withResolvers<void>().promise;

        await expect(vi.waitFor(() => never, 20)).rejects.toThrow('Timed out in waitFor!');
    });

    it('should start the message of its error with what is waited for', async () => {
        const options = { interval: 1, timeout: 20, message: 'the server' };
        const never = Promise.withResolvers<void>().promise;

        const failed = await rejectionOf(vi.waitFor(succeedsAt(Infinity, 'never'), options));
        const timedOut = await rejectionOf(vi.waitFor(() => never, options));

        expect(String(failed)).toMatch(/^Error: the server: call \d+$/u);
        expect(String(timedOut)).toBe('Error: the server: Timed out in waitFor!');
    });

    it('should move fake timers forward by the interval at each call, and time out in real time', async () => {
        vi.useFakeTimers({ now: 0 });
        const fired = vi.fn<() => void>();
        setTimeout(fired, 100);

        await vi.waitFor(() => {
            expect(fired).toHaveBeenCalledOnce();
        });
        const now = Date.now();
        const error = await rejectionOf(vi.waitFor(() => expect.fail('never'), 20));

        expect(now).toBe(100);
        expect(String(error)).toContain('never');
    });

    it('should reject with what a fake timer throws as the first call moves the clock', async () => {
        const callback = vi.fn<() => string>(() => 'value');
        vi.useFakeTimers();
        setTimeout(() => {
            throw new Error('timer');
        }, 10);

        await expect(vi.waitFor(callback)).rejects.toThrow('timer');
        expect(callback).not.toHaveBeenCalled();
    });
});

describe('vi.waitUntil', () => {
    property.prop(
        [
            fc.array(fc.constantFrom(false, 0, '', null, undefined), { maxLength: 3 }),
            fc.anything().filter(Boolean)
        ],
        { numRuns: 20 }
    )(
        "should call the function until its value isn't falsy, and resolve with it",
        async (falsy, value) => {
            const values = [...falsy, value];
            const callback = vi.fn<() => unknown>(() => values.shift());

            const result: unknown = await vi.waitUntil(callback, { interval: 1 });

            expect(Object.is(result, value)).toBe(true);
            expect(callback).toHaveBeenCalledTimes(falsy.length + 1);
        }
    );

    it('should await the promises that the function returns', async () => {
        const callback = vi
            .fn<() => Promise<number>>()
            .mockResolvedValueOnce(0)
            .mockResolvedValue(1);

        await expect(vi.waitUntil(callback, { interval: 1 })).resolves.toBe(1);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it("should reject with the function's error at once, thrown or rejected", async () => {
        const throws = vi.fn<() => string>(succeedsAt(Infinity, 'never'));
        const rejects = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('rejected'));

        await expect(vi.waitUntil(throws)).rejects.toThrow('call 1');
        await expect(vi.waitUntil(rejects)).rejects.toThrow('rejected');
        expect([throws, rejects].map(callback => callback.mock.calls.length)).toEqual([1, 1]);
    });

    property.prop([fc.constantFrom(false, 0, '', null, undefined), fc.boolean()], { numRuns: 10 })(
        "should reject with its timeout's error at once, when the function's error is falsy",
        async (falsy, rejects) => {
            const callback = vi.fn<() => Promise<never>>(() => {
                if (rejects) {
                    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- A falsy error is what is tested
                    return Promise.reject(falsy);
                }
                // oxlint-disable-next-line typescript/only-throw-error -- As above
                throw falsy;
            });

            const error = await rejectionOf(vi.waitUntil(callback, { message: 'the flag' }));

            expect(String(error)).toBe('Error: the flag: Timed out in waitUntil!');
            expect(callback).toHaveBeenCalledOnce();
        }
    );

    it('should reject with a timeout once it passes, after what is waited for', async () => {
        const options = { interval: 1, timeout: 20, message: 'the flag' };

        await expect(vi.waitUntil(() => false, 20)).rejects.toThrow('Timed out in waitUntil!');
        await expect(vi.waitUntil(() => false, options)).rejects.toThrow(
            'the flag: Timed out in waitUntil!'
        );
    });

    it('should move fake timers forward by the interval at each call', async () => {
        vi.useFakeTimers({ now: 0 });
        let fired = false;
        setTimeout(() => {
            fired = true;
        }, 100);

        await vi.waitUntil(() => fired);

        expect(Date.now()).toBe(100);
    });
});
