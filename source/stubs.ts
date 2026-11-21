// Vitest's stubs of globals and of environment variables: `vi.stubGlobal()`,
// `vi.stubEnv()`, and the members that undo them.
//
// Where it differs from Vitest:
//
// - `vi.stubEnv()` changes `process.env`. Vitest changes `import.meta.env`
//   too, which Vite defines, and Node doesn't.
// - Nothing undoes the stubs between tests. Vitest does with its
//   `unstubGlobals` and `unstubEnvs` options, which need its runner.

import { chained } from './chain.ts';

/** The names that Vitest's `vi.stubEnv()` takes a boolean for, as Vite's */
type BooleanEnv = 'DEV' | 'PROD' | 'SSR';

/**
 * The members of `vi` that stub globals and environment variables. Those
 * that Vitest's return `vi` from do here too, as `Vi`.
 */
export interface StubsAPI<Vi> {
    /**
     * Defines a global, whether or not there is one by the name, until
     * `vi.unstubAllGlobals()`.
     */
    stubGlobal(name: string | symbol | number, value: unknown): Vi;

    /**
     * Sets a variable of `process.env`, or deletes it if the value is
     * undefined, until `vi.unstubAllEnvs()`. `PROD`, `DEV`, and `SSR` take a
     * boolean, which is set as `'1'` or `''`.
     */
    stubEnv<Name extends string>(
        name: Name,
        value: Name extends BooleanEnv
            ? boolean | undefined
            : string | undefined
    ): Vi;

    /**
     * Leaves each global that `vi.stubGlobal()` defined as it was before the
     * first stub of it.
     */
    unstubAllGlobals(): Vi;

    /**
     * Leaves each variable that `vi.stubEnv()` set as it was before the first
     * stub of it.
     */
    unstubAllEnvs(): Vi;
}

const BOOLEAN_ENVS: ReadonlySet<string> = new Set(['PROD', 'DEV', 'SSR']);

/**
 * The members of `vi` that stub globals and environment variables, which
 * return what `vi` returns, for the calls that chain.
 */
export function createStubsAPI<Vi>(vi: () => Vi): StubsAPI<Vi> {
    /** Each stubbed global's descriptor before its first stub, if it had one */
    const globals = new Map<
        string | symbol | number,
        PropertyDescriptor | undefined
    >();
    /** Each stubbed variable's value before its first stub, if it was set */
    const envs = new Map<string, string | undefined>();

    const stubGlobal = (
        name: string | symbol | number,
        value: unknown
    ): void => {
        if (!globals.has(name)) {
            globals.set(
                name,
                Object.getOwnPropertyDescriptor(globalThis, name)
            );
        }

        Object.defineProperty(globalThis, name, {
            value,
            writable: true,
            configurable: true,
            enumerable: true
        });
    };

    const stubEnv = (
        name: string,
        value: string | boolean | undefined
    ): void => {
        if (!envs.has(name)) {
            envs.set(name, process.env[name]);
        }

        if (value == null) {
            delete process.env[name];
        } else if (BOOLEAN_ENVS.has(name)) {
            // A string counts as Vitest counts it, by its truthiness
            process.env[name] = value === false || value === '' ? '' : '1';
        } else {
            process.env[name] = String(value);
        }
    };

    const unstubAllGlobals = (): void => {
        for (const [name, original] of globals) {
            if (original == null) {
                Reflect.deleteProperty(globalThis, name);
            } else {
                Object.defineProperty(globalThis, name, original);
            }
        }
        globals.clear();
    };

    const unstubAllEnvs = (): void => {
        for (const [name, original] of envs) {
            if (original == null) {
                delete process.env[name];
            } else {
                process.env[name] = original;
            }
        }
        envs.clear();
    };

    return {
        stubEnv: chained(vi, stubEnv),
        stubGlobal: chained(vi, stubGlobal),
        unstubAllEnvs: chained(vi, unstubAllEnvs),
        unstubAllGlobals: chained(vi, unstubAllGlobals)
    };
}
