// Vitest's fake timers: `vi.useFakeTimers()` and the members of `vi` that go
// with it, on @sinonjs/fake-timers, as Vitest's are. node:test's
// `mock.timers` can't advance timers as promises settle, or count them.
//
// Vitest bundles a patched copy of @sinonjs/fake-timers, whose version
// package.json pins here, and which Vitest's version moves. The patch adds
// the `fakeNodeBuiltins` option, which is off by default. Without the patch,
// the package fakes the exports of `node:timers` and `node:timers/promises`
// whenever it fakes the globals, so `FakeTimers` gives them back unless the
// option is on, and syncs the modules' ES exports when it is, as the patch
// does.
//
// Where it differs from Vitest:
//
// - Vitest takes the default options from its configuration's `fakeTimers`.
//   Here they are Vitest's defaults, and each call of `vi.useFakeTimers()`
//   passes what it changes.
// - Vitest refuses to fake `nextTick` in a child process, which its runner
//   talks to its workers through. A test file is free to fake it here.
// - Vitest ends a test file's worker once its tests end. node:test waits for
//   the file's process to end, which a clock that moves by itself keeps
//   running, on a real timer: with `shouldAdvanceTime`, or a tick mode
//   besides `manual`, until `vi.useRealTimers()`.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import nodeTimers from 'node:timers';
import nodeTimersPromises from 'node:timers/promises';
import type * as SinonFakeTimers from '@sinonjs/fake-timers';
import { chained, chainedAsync } from './chain.ts';

type Clock = SinonFakeTimers.Clock;
type FakeMethod = SinonFakeTimers.FakeMethod;

/** A time to set the clock to: a timestamp, or what has or parses to one */
type SystemTime = number | string | Date | SinonFakeTimers.TemporalTimelike;

/** The options of `vi.useFakeTimers()`: @sinonjs/fake-timers', and Vitest's */
export interface FakeTimersConfig extends SinonFakeTimers.Config {
    /**
     * Fakes the timers that are imported from `node:timers` and
     * `node:timers/promises` too, rather than only the globals.
     *
     * @default false
     */
    fakeNodeBuiltins?: boolean;
}

/**
 * The members of `vi` that fake timers. Those that Vitest's return `vi` from
 * do here too, as `Vi`.
 *
 * Besides `useFakeTimers`, `useRealTimers`, `isFakeTimers`, `setSystemTime`,
 * `getMockedSystemTime`, `getRealSystemTime`, and `clearAllTimers`, each
 * throws unless the timers are fake.
 */
export interface TimersAPI<Vi> {
    /**
     * Replaces the timers and the clock with fake ones, which only the
     * members of `vi` advance, until `vi.useRealTimers()`. It leaves
     * `process.nextTick` and `queueMicrotask` alone, unless `toFake` names
     * them.
     */
    useFakeTimers(config?: FakeTimersConfig): Vi;
    /** Restores the timers and the clock, and discards the fake timers set */
    useRealTimers(): Vi;
    /** Whether `vi.useFakeTimers()` has replaced the timers */
    isFakeTimers(): boolean;

    /** Runs the timers that are waiting, but not those that they set */
    runOnlyPendingTimers(): Vi;
    /** As `runOnlyPendingTimers`, and awaits the timers that are set as promises settle */
    runOnlyPendingTimersAsync(): Promise<Vi>;
    /**
     * Runs timers until none wait, those that they set too. It throws after
     * `loopLimit` timers, 10 000 by default, as an interval never ends.
     */
    runAllTimers(): Vi;
    /** As `runAllTimers`, and awaits the timers that are set as promises settle */
    runAllTimersAsync(): Promise<Vi>;
    /** Runs the callbacks of `process.nextTick`, where `toFake` names it */
    runAllTicks(): Vi;

    /** Moves the clock forward by milliseconds, and runs the timers due by then */
    advanceTimersByTime(ms: number): Vi;
    /** As `advanceTimersByTime`, and awaits the timers that are set as promises settle */
    advanceTimersByTimeAsync(ms: number): Promise<Vi>;
    /** Moves the clock forward to the next timer, and runs it */
    advanceTimersToNextTimer(): Vi;
    /** As `advanceTimersToNextTimer`, and awaits the timer if it was set as a promise settled */
    advanceTimersToNextTimerAsync(): Promise<Vi>;
    /** Moves the clock forward to the next frame of `requestAnimationFrame` */
    advanceTimersToNextFrame(): Vi;

    /** The number of timers that are waiting */
    getTimerCount(): number;
    /** Removes the timers that are waiting, which then never run */
    clearAllTimers(): Vi;

    /**
     * Sets the clock, without running timers. While the timers are real, it
     * fakes only the date, until `vi.useRealTimers()`.
     */
    setSystemTime(time: SystemTime): Vi;
    /** The fake clock's time, or null while the date is real */
    getMockedSystemTime(): Date | null;
    /** The real time, in milliseconds, while the clock is fake too */
    getRealSystemTime(): number;

    /**
     * How the clock moves: only as `vi` advances it, which is `manual` and
     * the default, to the next timer after each macrotask, or by an
     * interval of milliseconds as real time passes.
     */
    setTimerTickMode(mode: 'manual' | 'nextTimerAsync'): Vi;
    setTimerTickMode(mode: 'interval', interval?: number): Vi;
}

/** How the clock moves, as `vi.setTimerTickMode()` names it */
type TickMode = 'manual' | 'nextTimerAsync' | 'interval';

/** The methods of a Node module that installing a clock replaced */
type ReplacedMethods = Clock['timersModuleMethods'];

/** Vitest's defaults for its configuration's `fakeTimers` */
const DEFAULT_CONFIG: FakeTimersConfig = {
    loopLimit: 10_000,
    shouldClearNativeTimers: true
};

/** The timers that Node runs on itself, which stay real unless they're named */
const NODE_INTERNAL: readonly FakeMethod[] = ['nextTick', 'queueMicrotask'];

const require = createRequire(import.meta.url);
const realNow = Date.now;

/** Gives a Node module the methods that installing a clock replaced */
function restoreMethods(module: object, replaced: ReplacedMethods = []): void {
    for (const { methodName, original } of replaced) {
        Reflect.set(module, methodName, original);
    }
}

/** The time as @sinonjs/fake-timers takes it, which reads no strings */
function toClockTime(time: SystemTime | undefined): number | Date | undefined {
    // A Temporal instant or zoned date-time, read without Temporal's types
    const normalized =
        typeof time === 'object' && 'epochMilliseconds' in time
            ? time.epochMilliseconds
            : time;

    return typeof normalized === 'string' ? new Date(normalized) : normalized;
}

/**
 * The fake clock of a process: Vitest's `FakeTimers`, which fakes either the
 * timers and the date, once `useFakeTimers()` is called, or only the date,
 * once `setSystemTime()` is called while the timers are real.
 */
class FakeTimers {
    #context: SinonFakeTimers.FakeTimers | undefined;
    /** The clock that is installed, while the timers or the date are fake */
    #clock: Clock | undefined;
    #fakingTime = false;
    /** The date that `setSystemTime()` set, while only the date is fake */
    #fakingDate: Date | undefined;
    #fakingNodeBuiltins = false;

    isFakeTimers(): boolean {
        return this.#fakingTime;
    }

    useFakeTimers(config: FakeTimersConfig = {}): void {
        const now = this.#fakingDate ?? Date.now();
        this.useRealTimers();

        const userConfig = { ...DEFAULT_CONFIG, ...config };
        let { toFake, toNotFake } = userConfig;

        if (toFake == null && toNotFake == null) {
            toFake = this.#fakeable().filter(
                timer => !NODE_INTERNAL.includes(timer)
            );
        } else if (toFake == null && toNotFake != null) {
            toNotFake = [...new Set([...toNotFake, ...NODE_INTERNAL])];
        }

        this.#install({
            now,
            ...userConfig,
            ...(toFake && { toFake }),
            ...(toNotFake && { toNotFake }),
            ignoreMissingTimers: true
        });
        this.#fakingTime = true;
    }

    useRealTimers(): void {
        if (this.#clock == null) {
            return;
        }

        this.#clock.uninstall();
        if (this.#fakingNodeBuiltins) {
            syncBuiltinESMExports();
        }

        this.#clock = undefined;
        this.#fakingTime = false;
        this.#fakingDate = undefined;
        this.#fakingNodeBuiltins = false;
    }

    runOnlyPendingTimers(): void {
        this.#fakeClock().runToLast();
    }

    async runOnlyPendingTimersAsync(): Promise<void> {
        await this.#fakeClock().runToLastAsync();
    }

    runAllTimers(): void {
        this.#fakeClock().runAll();
    }

    async runAllTimersAsync(): Promise<void> {
        await this.#fakeClock().runAllAsync();
    }

    runAllTicks(): void {
        this.#fakeClock().runMicrotasks();
    }

    advanceTimersByTime(ms: number): void {
        this.#fakeClock().tick(ms);
    }

    async advanceTimersByTimeAsync(ms: number): Promise<void> {
        await this.#fakeClock().tickAsync(ms);
    }

    advanceTimersToNextTimer(): void {
        const clock = this.#fakeClock();

        clock.next();
        // `next()` runs one timer, and this the others that are due with it
        clock.tick(0);
    }

    async advanceTimersToNextTimerAsync(): Promise<void> {
        const clock = this.#fakeClock();

        await clock.nextAsync();
        clock.tick(0);
    }

    advanceTimersToNextFrame(): void {
        this.#fakeClock().runToFrame();
    }

    getTimerCount(): number {
        return this.#fakeClock().countTimers();
    }

    clearAllTimers(): void {
        if (this.#fakingTime) {
            this.#clock?.reset();
        }
    }

    setSystemTime(time?: SystemTime): void {
        const date = toClockTime(time);

        if (this.#fakingTime) {
            this.#clock?.setSystemTime(date);
            return;
        }

        const fakingDate = date == null ? new Date(realNow()) : new Date(date);
        if (this.#clock == null) {
            this.#install({
                now: fakingDate,
                toFake: ['Date', 'Temporal'],
                ignoreMissingTimers: true
            });
        } else {
            this.#clock.setSystemTime(fakingDate);
        }
        this.#fakingDate = fakingDate;
    }

    getMockedSystemTime(): Date | null {
        if (this.#fakingTime && this.#clock != null) {
            return new Date(this.#clock.now);
        }

        return this.#fakingDate ?? null;
    }

    getRealSystemTime(): number {
        return realNow();
    }

    setTimerTickMode(mode: TickMode, interval?: number): void {
        const clock = this.#fakeClock();

        switch (mode) {
            case 'manual':
                clock.setTickMode({ mode: 'manual' });
                break;
            case 'nextTimerAsync':
                clock.setTickMode({ mode: 'nextAsync' });
                break;
            case 'interval':
                clock.setTickMode({ mode: 'interval', delta: interval });
                break;
            default:
                throw new Error(`Invalid tick mode: ${String(mode)}`);
        }
    }

    /** The clock, for the members that need the timers to be fake */
    #fakeClock(): Clock {
        if (!this.#fakingTime || this.#clock == null) {
            throw new Error(
                'A function to advance timers was called but the timers APIs are not mocked. ' +
                    'Call `vi.useFakeTimers()` in the test file first.'
            );
        }

        return this.#clock;
    }

    /** What @sinonjs/fake-timers can fake */
    #fakeable(): FakeMethod[] {
        return Object.keys(this.#loadContext().timers) as FakeMethod[];
    }

    /**
     * Installs a clock, and leaves the exports of Node's timers modules as
     * `fakeNodeBuiltins` says: fake, in their ES exports too, or real.
     */
    #install({ fakeNodeBuiltins = false, ...config }: FakeTimersConfig): void {
        const clock = this.#loadContext().install(config);

        if (fakeNodeBuiltins) {
            syncBuiltinESMExports();
        } else {
            restoreMethods(nodeTimers, clock.timersModuleMethods);
            restoreMethods(
                nodeTimersPromises,
                clock.timersPromisesModuleMethods
            );
            // So that uninstalling the clock doesn't restore them again
            clock.timersModuleMethods = undefined;
            clock.timersPromisesModuleMethods = undefined;
        }

        this.#clock = clock;
        this.#fakingNodeBuiltins = fakeNodeBuiltins;
    }

    /** @sinonjs/fake-timers, which loads once a test fakes the timers or the date */
    #loadContext(): SinonFakeTimers.FakeTimers {
        if (this.#context == null) {
            const { withGlobal } =
                require('@sinonjs/fake-timers') as typeof SinonFakeTimers;
            this.#context = withGlobal(globalThis);
        }

        return this.#context;
    }
}

/**
 * The members of `vi` that fake timers, which return what `vi` returns, for
 * the calls that chain.
 */
export function createTimersAPI<Vi>(vi: () => Vi): TimersAPI<Vi> {
    const timers = new FakeTimers();

    return {
        useFakeTimers: chained(vi, config => timers.useFakeTimers(config)),
        useRealTimers: chained(vi, () => timers.useRealTimers()),
        isFakeTimers: () => timers.isFakeTimers(),

        runOnlyPendingTimers: chained(vi, () => timers.runOnlyPendingTimers()),
        runOnlyPendingTimersAsync: chainedAsync(vi, () =>
            timers.runOnlyPendingTimersAsync()
        ),
        runAllTimers: chained(vi, () => timers.runAllTimers()),
        runAllTimersAsync: chainedAsync(vi, () => timers.runAllTimersAsync()),
        runAllTicks: chained(vi, () => timers.runAllTicks()),

        advanceTimersByTime: chained(vi, ms => timers.advanceTimersByTime(ms)),
        advanceTimersByTimeAsync: chainedAsync(vi, ms =>
            timers.advanceTimersByTimeAsync(ms)
        ),
        advanceTimersToNextTimer: chained(vi, () =>
            timers.advanceTimersToNextTimer()
        ),
        advanceTimersToNextTimerAsync: chainedAsync(vi, () =>
            timers.advanceTimersToNextTimerAsync()
        ),
        advanceTimersToNextFrame: chained(vi, () =>
            timers.advanceTimersToNextFrame()
        ),

        getTimerCount: () => timers.getTimerCount(),
        clearAllTimers: chained(vi, () => timers.clearAllTimers()),

        setSystemTime: chained(vi, time => timers.setSystemTime(time)),
        getMockedSystemTime: () => timers.getMockedSystemTime(),
        getRealSystemTime: () => timers.getRealSystemTime(),

        setTimerTickMode: chained(vi, (mode: TickMode, interval?: number) =>
            timers.setTimerTickMode(mode, interval)
        )
    };
}
