// The members of `vi` that Vitest's return `vi` from, so that calls chain,
// as in `vi.useFakeTimers().setSystemTime(0)`. `vi` is passed as a function,
// since the members are made before it is.

/** A member of `vi` that runs, and returns `vi` */
export function chained<Vi, Args extends unknown[]>(
    vi: () => Vi,
    run: (...args: Args) => void
): (...args: Args) => Vi {
    return (...args) => {
        run(...args);
        return vi();
    };
}

/** A member of `vi` that runs, and returns a promise of `vi` */
export function chainedAsync<Vi, Args extends unknown[]>(
    vi: () => Vi,
    run: (...args: Args) => Promise<void>
): (...args: Args) => Promise<Vi> {
    return async (...args) => {
        await run(...args);
        return vi();
    };
}
