import nodeTimers, { setTimeout as importedSetTimeout } from 'node:timers';
import nodeTimersPromises, { setTimeout as importedSleep } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'hypotes';
import { fc, it as property } from 'hypotes/fast-check';

/** `process.nextTick`, as it is now, to compare */
function nextTick(): unknown {
    return Reflect.get(process, 'nextTick');
}

const real = {
    Date,
    nextTick: nextTick(),
    queueMicrotask,
    setTimeout,
    nodeSetTimeout: nodeTimers.setTimeout,
    nodeSleep: nodeTimersPromises.setTimeout,
    Temporal: Reflect.get(globalThis, 'Temporal') as unknown
};

/** The delays of timers, in milliseconds */
const delays = fc.array(fc.integer({ min: 1, max: 1000 }), { maxLength: 8 });

/** Sets a timer for each delay, and returns the delays of those that ran */
function setTimers(delays: readonly number[]): number[] {
    const ran: number[] = [];
    for (const delay of delays) {
        setTimeout(() => ran.push(delay), delay);
    }

    return ran;
}

/** Waits in real time, whatever the timers are */
function realDelay(ms: number): Promise<void> {
    return new Promise(resolve => {
        real.setTimeout(resolve, ms);
    });
}

/** Sets a timer once a promise settles, as a retry after a request does */
async function setTimerAfterPromise(delay: number, callback: () => void): Promise<void> {
    await Promise.resolve();
    setTimeout(callback, delay);
}

afterEach(() => {
    vi.useRealTimers();
});

describe('vi.useFakeTimers', () => {
    it('should replace the timers and the date, until vi.useRealTimers()', () => {
        vi.useFakeTimers();
        const faked = [vi.isFakeTimers(), setTimeout === real.setTimeout, Date === real.Date];
        vi.useRealTimers();

        expect(faked).toEqual([true, false, false]);
        expect([vi.isFakeTimers(), setTimeout, Date]).toEqual([false, real.setTimeout, real.Date]);
    });

    it('should leave process.nextTick and queueMicrotask real, unless toFake names them', () => {
        vi.useFakeTimers();
        const byDefault = [nextTick(), queueMicrotask];
        vi.useFakeTimers({ toFake: ['nextTick', 'queueMicrotask'] });
        const named = [nextTick() === real.nextTick, queueMicrotask === real.queueMicrotask];
        vi.useFakeTimers({ toNotFake: ['Date'] });
        const notNamed = [nextTick(), queueMicrotask, Date];

        expect(byDefault).toEqual([real.nextTick, real.queueMicrotask]);
        expect(named).toEqual([false, false]);
        expect(notNamed).toEqual([real.nextTick, real.queueMicrotask, real.Date]);
    });

    it('should run the callbacks of a fake process.nextTick with vi.runAllTicks()', () => {
        const callback = vi.fn<() => void>();
        vi.useFakeTimers({ toFake: ['nextTick'] });

        process.nextTick(callback);
        const before = callback.mock.calls.length;
        vi.runAllTicks();

        expect([before, callback.mock.calls.length]).toEqual([0, 1]);
    });

    it("should leave node:timers' exports real, unless fakeNodeBuiltins is set", () => {
        const callback = vi.fn<() => void>();

        vi.useFakeTimers();
        const byDefault = nodeTimers.setTimeout;
        vi.useFakeTimers({ fakeNodeBuiltins: true });
        importedSetTimeout(callback, 10);
        vi.advanceTimersByTime(10);
        vi.useRealTimers();

        expect(byDefault).toBe(real.nodeSetTimeout);
        expect(callback).toHaveBeenCalledOnce();
        expect([nodeTimers.setTimeout, importedSetTimeout]).toEqual([
            real.nodeSetTimeout,
            real.nodeSetTimeout
        ]);
    });

    it("should leave node:timers/promises' exports real, unless fakeNodeBuiltins is set", async () => {
        const slept = vi.fn<() => void>();

        vi.useFakeTimers();
        const byDefault = nodeTimersPromises.setTimeout;
        vi.useFakeTimers({ fakeNodeBuiltins: true });
        // A second of the fake clock, which real time doesn't reach here
        void importedSleep(1000).then(slept);
        await vi.advanceTimersByTimeAsync(1000);
        vi.useRealTimers();

        expect(byDefault).toBe(real.nodeSleep);
        expect(slept).toHaveBeenCalledOnce();
        expect([nodeTimersPromises.setTimeout, importedSleep]).toEqual([
            real.nodeSleep,
            real.nodeSleep
        ]);
    });

    it('should keep the time that vi.setSystemTime() set before it', () => {
        vi.setSystemTime(1000);
        vi.useFakeTimers();

        expect(Date.now()).toBe(1000);
    });

    it('should return vi, as the members that return nothing else do', async () => {
        expect(vi.useFakeTimers()).toBe(vi);
        expect(vi.setSystemTime(0).advanceTimersByTime(1).runAllTimers()).toBe(vi);
        expect(vi.runOnlyPendingTimers().advanceTimersToNextTimer().runAllTicks()).toBe(vi);
        expect(vi.advanceTimersToNextFrame().clearAllTimers().setTimerTickMode('manual')).toBe(vi);
        expect(await vi.advanceTimersByTimeAsync(1)).toBe(vi);
        expect(await vi.runAllTimersAsync()).toBe(vi);
        expect(await vi.runOnlyPendingTimersAsync()).toBe(vi);
        expect(await vi.advanceTimersToNextTimerAsync()).toBe(vi);
        expect(vi.useRealTimers()).toBe(vi);
    });
});

describe('advancing fake timers', () => {
    property.prop([delays, fc.integer({ min: 0, max: 1000 })])(
        'should run the timers that are due, in order, and count the rest',
        (delays, ms) => {
            vi.useFakeTimers();
            const ran = setTimers(delays);

            vi.advanceTimersByTime(ms);
            const waiting = vi.getTimerCount();
            vi.useRealTimers();

            const due = delays.filter(delay => delay <= ms).toSorted((a, b) => a - b);
            expect(ran).toEqual(due);
            expect(waiting).toBe(delays.length - due.length);
        }
    );

    property.prop([delays])('should run every timer with vi.runAllTimers()', delays => {
        vi.useFakeTimers();
        const ran = setTimers(delays);

        vi.runAllTimers();
        const waiting = vi.getTimerCount();
        vi.useRealTimers();

        expect(ran).toEqual(delays.toSorted((a, b) => a - b));
        expect(waiting).toBe(0);
    });

    it('should move the clock with the timers', () => {
        vi.useFakeTimers({ now: 1000 });
        const times: number[] = [];
        setTimeout(() => times.push(Date.now()), 50);

        vi.advanceTimersByTime(200);

        expect([times, Date.now()]).toEqual([[1050], 1200]);
    });

    it('should leave a timer that a timer set to vi.runOnlyPendingTimers()', () => {
        const nested = vi.fn<() => void>();
        vi.useFakeTimers();
        setTimeout(() => setTimeout(nested, 10), 10);

        vi.runOnlyPendingTimers();
        const afterPending = nested.mock.calls.length;
        vi.runOnlyPendingTimers();

        expect([afterPending, nested.mock.calls.length]).toEqual([0, 1]);
    });

    it('should run one time of timers with vi.advanceTimersToNextTimer()', () => {
        vi.useFakeTimers();
        const ran = setTimers([20, 10, 10]);

        vi.advanceTimersToNextTimer();
        const first = [...ran];
        vi.advanceTimersToNextTimer();

        expect([first, ran]).toEqual([
            [10, 10],
            [10, 10, 20]
        ]);
    });

    it('should run a timer that is set as a promise settles, with the async members only', async () => {
        const callback = vi.fn<() => void>();
        vi.useFakeTimers();

        void setTimerAfterPromise(10, callback);
        vi.advanceTimersByTime(10);
        const afterSync = callback.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10);

        expect([afterSync, callback.mock.calls.length]).toEqual([0, 1]);
    });

    it('should await such timers with each async member', async () => {
        const callback = vi.fn<() => void>();
        vi.useFakeTimers();

        void setTimerAfterPromise(10, callback);
        await vi.runAllTimersAsync();
        void setTimerAfterPromise(10, callback);
        await vi.advanceTimersToNextTimerAsync();
        void setTimerAfterPromise(10, callback);
        await vi.runOnlyPendingTimersAsync();

        expect(callback).toHaveBeenCalledTimes(3);
    });

    it('should stop vi.runAllTimers() at loopLimit timers, which an interval never ends', () => {
        vi.useFakeTimers({ loopLimit: 5 });
        setInterval(() => undefined, 10);

        expect(() => vi.runAllTimers()).toThrow(/5 timers/u);
    });

    it('should remove the waiting timers with vi.clearAllTimers()', () => {
        vi.useFakeTimers();
        const ran = setTimers([10, 20]);

        vi.clearAllTimers();
        const waiting = vi.getTimerCount();
        vi.advanceTimersByTime(20);

        expect([waiting, ran]).toEqual([0, []]);
    });

    it('should move the clock to each timer by itself, with the tick mode nextTimerAsync', async () => {
        vi.useFakeTimers({ now: 0 });
        vi.setTimerTickMode('nextTimerAsync');

        await new Promise(resolve => {
            setTimeout(resolve, 60_000);
        });

        expect(Date.now()).toBe(60_000);
    });

    it.each([
        ['advanceTimersByTime', () => vi.advanceTimersByTime(1)],
        ['runAllTimers', () => vi.runAllTimers()],
        ['runOnlyPendingTimers', () => vi.runOnlyPendingTimers()],
        ['advanceTimersToNextTimer', () => vi.advanceTimersToNextTimer()],
        ['advanceTimersToNextFrame', () => vi.advanceTimersToNextFrame()],
        ['runAllTicks', () => vi.runAllTicks()],
        ['getTimerCount', () => vi.getTimerCount()],
        ['setTimerTickMode', () => vi.setTimerTickMode('manual')]
    ])('should throw from vi.%s() while the timers are real', (_name, advance) => {
        expect(advance).toThrow('Call `vi.useFakeTimers()` in the test file first.');
    });

    it('should reject from an async member while the timers are real', async () => {
        await expect(vi.advanceTimersByTimeAsync(1)).rejects.toThrow('timers APIs are not mocked');
    });
});

describe('fake timers that move by themselves', () => {
    it('should move the clock as real time passes, with shouldAdvanceTime', async () => {
        const callback = vi.fn<() => void>();
        vi.useFakeTimers({ now: 0, shouldAdvanceTime: true, advanceTimeDelta: 5 });
        setTimeout(callback, 10);

        await realDelay(100);
        const now = Date.now();
        vi.useRealTimers();

        expect(callback).toHaveBeenCalledOnce();
        // By its delta at each real one, so by no more than the real time
        expect(now).toBeGreaterThanOrEqual(10);
        expect(now).toBeLessThanOrEqual(1000);
    });

    it('should move the clock by an interval as real time passes, with the tick mode interval', async () => {
        const callback = vi.fn<() => void>();
        vi.useFakeTimers({ now: 0 });
        vi.setTimerTickMode('interval', 5);
        setTimeout(callback, 10);

        await realDelay(100);
        const now = Date.now();
        vi.setTimerTickMode('manual');
        await realDelay(20);

        expect(callback).toHaveBeenCalledOnce();
        expect(now).toBeGreaterThanOrEqual(10);
        expect(Date.now()).toBe(now);
    });

    it('should leave the clock alone in real time, by default', async () => {
        vi.useFakeTimers({ now: 0 });

        await realDelay(20);

        expect(Date.now()).toBe(0);
    });
});

describe('vi.advanceTimersToNextFrame', () => {
    it('should move the clock to the next frame, of 16 milliseconds', () => {
        vi.useFakeTimers({ now: 0 });
        const ran = setTimers([10, 20]);

        vi.advanceTimersToNextFrame();
        const first = [[...ran], Date.now()];
        vi.advanceTimersToNextFrame();

        expect(first).toEqual([[10], 16]);
        expect([ran, Date.now()]).toEqual([[10, 20], 32]);
    });
});

describe('vi.setSystemTime', () => {
    const timestamp = fc.integer({ min: 0, max: 4_102_444_800_000 });

    property.prop([timestamp, delays])(
        'should set the clock of fake timers, without running them',
        (time, delays) => {
            vi.useFakeTimers();
            const ran = setTimers(delays);

            vi.setSystemTime(time);
            const now = [Date.now(), vi.getMockedSystemTime()?.getTime()];
            const constructed = new Date().toISOString();
            vi.useRealTimers();

            expect(now).toEqual([time, time]);
            expect(constructed).toBe(new Date(time).toISOString());
            expect(ran).toEqual([]);
        }
    );

    property.prop([timestamp])('should take a date, or a string of one', time => {
        vi.useFakeTimers();

        vi.setSystemTime(new real.Date(time));
        const fromDate = Date.now();
        vi.setSystemTime(new real.Date(time).toISOString());
        const fromString = Date.now();
        vi.useRealTimers();

        expect([fromDate, fromString]).toEqual([time, time]);
    });

    property.prop([timestamp, fc.boolean()])(
        "should take what has Temporal's epochMilliseconds, with fake timers or without",
        (time, fakeTimers) => {
            if (fakeTimers) {
                vi.useFakeTimers();
            }

            vi.setSystemTime({ epochMilliseconds: time });
            const now = Date.now();
            vi.useRealTimers();

            expect(now).toBe(time);
        }
    );

    it.runIf('Temporal' in globalThis)(
        'should fake Temporal with the date, where Node has it',
        () => {
            vi.setSystemTime(1000);
            const dateOnly: unknown = Reflect.get(globalThis, 'Temporal');
            vi.useFakeTimers({ now: 2000 });
            const now = String(Temporal.Now.instant().epochMilliseconds);
            vi.useRealTimers();

            expect(dateOnly).not.toBe(real.Temporal);
            expect(now).toBe('2000');
            expect(Reflect.get(globalThis, 'Temporal')).toBe(real.Temporal);
        }
    );

    it('should fake only the date while the timers are real, until vi.useRealTimers()', () => {
        vi.setSystemTime(1000);
        const faked = [Date.now(), vi.getMockedSystemTime()?.getTime(), vi.isFakeTimers()];
        const timer = setTimeout;
        vi.setSystemTime(2000);
        const again = Date.now();
        vi.useRealTimers();

        expect(faked).toEqual([1000, 1000, false]);
        expect(timer).toBe(real.setTimeout);
        expect(again).toBe(2000);
        expect([Date, vi.getMockedSystemTime()]).toEqual([real.Date, null]);
    });

    it('should keep the real time for vi.getRealSystemTime()', () => {
        const before = Date.now();
        vi.useFakeTimers({ now: 0 });

        const now = vi.getRealSystemTime();
        vi.useRealTimers();

        expect(now).toBeGreaterThanOrEqual(before);
        expect(now).toBeLessThanOrEqual(Date.now());
    });
});
