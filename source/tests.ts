// Tests and suites, declared through node:test with Vitest's API: `.each`
// and `.for`, with rows in an array or a table in a template literal,
// `.skipIf` and `.runIf`, `.fails`, and a timeout after the function.
import { AsyncLocalStorage } from 'node:async_hooks';
import * as nodeTest from 'node:test';
import { toArray } from '@vitest/utils/helpers';
import type { TestContext } from './current-test.ts';
import { callerSite, callFrom, type Site } from './site.ts';
import { parseTable } from './table.ts';
import { runTest } from './test-run.ts';
import { formatTitle } from './title.ts';

export type { TestContext };

type Awaitable<T> = PromiseLike<T> | T;

/**
 * The options of a test or a suite, which node:test takes, besides `fails`
 */
export interface TestOptions {
    /** Milliseconds after which the test fails */
    readonly timeout?: number;
    /** Skips it, with the reason if a string */
    readonly skip?: boolean | string;
    /**
     * Marks it as to do: it runs, and its failure is reported but doesn't
     * fail the run
     */
    readonly todo?: boolean | string;
    /**
     * Runs it, and the others marked only, rather than every test, when
     * `--test-only` is passed or tests run in one process
     */
    readonly only?: boolean;
    /** How many of its subtests run at once, or all at once if true */
    readonly concurrency?: boolean | number;
    /**
     * Passes the test if it fails, and fails it if it passes. A suite's is
     * that of its tests, unless they have their own.
     */
    readonly fails?: boolean;
}

export type SuiteContext = nodeTest.SuiteContext;
export type TestFunction = (context: TestContext) => Awaitable<unknown>;
export type SuiteFunction = (context: SuiteContext) => Awaitable<unknown>;

/**
 * Declares a test or a suite, with its options before its function, as
 * Vitest and node:test take them, or a timeout alone after it. As in Vitest
 * 4, options after the function throw a TypeError. Without a function, it's
 * to do.
 */
export interface Declare<Fn> {
    (name: string, fn?: Fn, timeout?: number): void;
    (name: string, options: TestOptions, fn?: Fn): void;
}

/**
 * A row of a table in a template literal, whose columns only the template's
 * text names. Its values are typed as any, as Vitest types them, so that a
 * function can destructure them, or declare their types.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- TypeScript can't read the columns from the template
export type TableRow = any;

/**
 * Declares a test or a suite for each row, which `formatTitle` names. Its
 * function takes the row's values, if every row is an array, and otherwise
 * the row. A readonly row's values are spread into parameters, which can't be
 * readonly. The rows of a table in a template literal are objects.
 */
export interface Each<Result> {
    <Row extends readonly unknown[] | [unknown]>(
        rows: readonly Row[]
    ): Declare<(...values: [...Row]) => Result>;
    <Row>(rows: readonly Row[]): Declare<(row: Row) => Result>;
    (
        strings: TemplateStringsArray,
        ...values: unknown[]
    ): Declare<(row: TableRow) => Result>;
}

/**
 * Declares a test or a suite for each row, which `formatTitle` names. Its
 * function takes the row, whether or not it's an array, and a test's
 * context. The rows of a table in a template literal are objects.
 */
export interface For<Context extends unknown[]> {
    <Row>(
        rows: readonly Row[]
    ): Declare<(row: Row, ...context: Context) => Awaitable<unknown>>;
    (
        strings: TemplateStringsArray,
        ...values: unknown[]
    ): Declare<(row: TableRow, ...context: Context) => Awaitable<unknown>>;
}

/** The variants of a test or a suite, which apply to any combination */
export interface Modifiers<API> {
    /** Skips it */
    readonly skip: API;
    /** Runs it, and the others marked only, rather than every test */
    readonly only: API;
    /** Marks it as to do */
    readonly todo: API;
    /** Skips it if the condition holds */
    skipIf(condition: unknown): API;
    /** Skips it unless the condition holds */
    runIf(condition: unknown): API;
}

/** `it` and `test`, with members that a subpath, such as fast-check's, adds */
export interface TestAPI<Extra = unknown>
    extends Declare<TestFunction>, Modifiers<TestAPI<Extra> & Extra> {
    /** Passes it if it fails, and fails it if it passes */
    readonly fails: TestAPI<Extra> & Extra;
    readonly each: Each<Awaitable<unknown>>;
    readonly for: For<[context: TestContext]>;
}

/** `describe` and `suite` */
export interface SuiteAPI extends Declare<SuiteFunction>, Modifiers<SuiteAPI> {
    readonly each: Each<Awaitable<unknown>>;
    readonly for: For<[]>;
}

/** Declares a test or a suite through node:test, from the site */
type Register = (
    name: string,
    options: TestOptions,
    fn: ((context: never) => unknown) | undefined,
    site: Site | undefined
) => void;

/**
 * Declares a test or a suite with the options that its modifiers set, from
 * the site where a test file declared it
 */
export type Define<Fn> = (
    name: string,
    options: TestOptions,
    fn: Fn | undefined,
    site: Site | undefined
) => void;

type Argument<Fn> = Fn | TestOptions | number | undefined;

/**
 * The function and options of a declaration, as Vitest 4 reads them: its
 * options before its function, or a timeout after it. It throws a TypeError,
 * with Vitest's message, for options after the function, which Vitest took
 * until 4, and for two functions.
 */
export function parseArguments<Fn>(
    first: Argument<Fn>,
    second: Argument<Fn>
): { fn: Fn | undefined; options: TestOptions } {
    if (second !== null && typeof second === 'object') {
        throw new TypeError(
            'Signature "test(name, fn, { ... })" was deprecated in Vitest 3 and removed in Vitest 4. Please, provide options as a second argument instead.'
        );
    }
    if (typeof first === 'function' && typeof second === 'function') {
        throw new TypeError(
            'Cannot use two functions as arguments. Please use the second argument for options.'
        );
    }

    return { fn: functionOf(first, second), options: optionsOf(first, second) };
}

/** The function of a declaration, before a timeout or after its options */
function functionOf<Fn>(
    first: Argument<Fn>,
    second: Argument<Fn>
): Fn | undefined {
    if (typeof first === 'function') {
        return first;
    }

    return typeof second === 'function' ? second : undefined;
}

/**
 * The options of a declaration: a timeout after its function, or else the
 * options before it
 */
function optionsOf<Fn>(first: Argument<Fn>, second: Argument<Fn>): TestOptions {
    if (typeof second === 'number') {
        return { timeout: second };
    }

    return typeof first === 'object' ? (first as TestOptions) : {};
}

/** What makes the API of `it` differ from the API of `describe` */
interface Kind<Fn> {
    /** Declares it through node:test */
    readonly register: Register;
    /** The options that each modifier besides the shared ones sets, by name */
    readonly modifiers: Readonly<Record<string, TestOptions>>;
    /** Adds members, such as `prop`, which declare with the same options */
    readonly extend: (define: Define<Fn>) => object;
}

/**
 * The API of `it` or `describe`, of options that its modifiers set: each
 * modifier builds another, when it's read.
 */
function createAPI<Fn>(kind: Kind<Fn>, options: TestOptions): object {
    const { register, extend } = kind;

    const define: Define<Fn> = (name, ownOptions, fn, site) => {
        const merged = { ...options, ...ownOptions };
        // Vitest marks a test without a function as to do, where node:test
        // would pass it
        const todo = fn == null ? { todo: true } : {};
        register(name, { ...merged, ...todo }, fn as never, site);
    };
    const build = (more: TestOptions): object =>
        createAPI(kind, { ...options, ...more });
    const skipIf = (skip: boolean): object => build(skip ? { skip: true } : {});

    const declare = (
        name: string,
        first?: Argument<Fn>,
        second?: Argument<Fn>
    ): void => {
        const parsed = parseArguments(first, second);
        define(name, parsed.options, parsed.fn, callerSite());
    };

    const modifiers = Object.entries(kind.modifiers).map(
        ([name, more]): [string, PropertyDescriptor] => [
            name,
            { get: () => build(more) }
        ]
    );

    return Object.defineProperties(Object.assign(declare, extend(define)), {
        ...Object.fromEntries(modifiers),
        skip: { get: () => build({ skip: true }) },
        only: { get: () => build({ only: true }) },
        todo: { get: () => build({ todo: true }) },
        skipIf: { value: (condition: unknown) => skipIf(Boolean(condition)) },
        runIf: {
            value: (condition: unknown) => {
                const run = Boolean(condition);
                return skipIf(!run);
            }
        },
        each: { value: each(define) },
        for: { value: forEach(define) }
    });
}

/**
 * The rows that `.each` or `.for` declares, from what it's called with: a
 * table's, if values follow the cases, as a template literal's follow its
 * strings, and otherwise the cases themselves. As in Vitest, the strings of a
 * template literal without values are its rows.
 */
function rowsOf(
    cases: readonly unknown[],
    values: readonly unknown[]
): readonly unknown[] {
    return values.length > 0
        ? parseTable(cases as readonly string[], values)
        : cases;
}

/** `.each`: spreads the rows if every row is an array */
function each<Fn>(
    define: Define<Fn>
): (cases: readonly unknown[], ...values: unknown[]) => Declare<Fn> {
    return (cases, ...values) => {
        const rows = rowsOf(cases, values);

        return (
            name: string,
            first?: Argument<Fn>,
            second?: Argument<Fn>
        ): void => {
            const site = callerSite();
            const { fn, options } = parseArguments(first, second);
            const handler = fn as
                | ((...values: unknown[]) => unknown)
                | undefined;
            const spread = rows.every(row => Array.isArray(row));

            for (const [index, row] of rows.entries()) {
                const items: unknown[] = Array.isArray(row) ? row : [row];
                const title = formatTitle(name, items, index);
                const run = (): unknown =>
                    spread ? handler?.(...items) : handler?.(row);

                define(title, options, handler && (run as Fn), site);
            }
        };
    };
}

/** `.for`: passes each row whole, and a test's context after it */
function forEach<Fn>(
    define: Define<Fn>
): (cases: readonly unknown[], ...values: unknown[]) => Declare<Fn> {
    return (cases, ...values) => {
        const rows = rowsOf(cases, values);

        return (
            name: string,
            first?: Argument<Fn>,
            second?: Argument<Fn>
        ): void => {
            const site = callerSite();
            const { fn, options } = parseArguments(first, second);
            const handler = fn as
                | ((...values: unknown[]) => unknown)
                | undefined;

            for (const [index, row] of rows.entries()) {
                const title = formatTitle(name, toArray(row), index);
                const run = (context: unknown): unknown =>
                    handler?.(row, context);

                define(title, options, handler && (run as Fn), site);
            }
        };
    };
}

/**
 * Whether the tests that a suite's function declares fail, as the suite's
 * options have it: node:test knows nothing of `fails`
 */
const suiteFails = new AsyncLocalStorage<boolean>();

/**
 * Declares a test through node:test, which awaits its run. The test `fails`
 * as its run has it.
 */
function registerTest(
    name: string,
    { fails = suiteFails.getStore() ?? false, ...options }: TestOptions,
    fn: ((context: never) => unknown) | undefined,
    site: Site | undefined
): void {
    // node:test passes a callback as well to a function of two parameters
    const test =
        fn &&
        ((context: nodeTest.TestContext): Promise<void> =>
            runTest(context, fn as TestFunction, fails));
    void callFrom(site, nodeTest.it, name, options, test);
}

/** Declares a suite through node:test, which awaits it */
function registerSuite(
    name: string,
    { fails = suiteFails.getStore() ?? false, ...options }: TestOptions,
    fn: ((context: never) => unknown) | undefined,
    site: Site | undefined
): void {
    const suite =
        fn &&
        ((context: SuiteContext) =>
            suiteFails.run(fails, () => (fn as SuiteFunction)(context)));
    void callFrom(
        site,
        nodeTest.describe,
        name,
        options,
        suite as nodeTest.SuiteFn | undefined
    );
}

/**
 * The API of `it` and `test`, with the members that `extend` adds at each
 * modifier, such as fast-check's `prop`
 */
export function createTestAPI<Extra extends object>(
    extend: (define: Define<TestFunction>) => Extra
): TestAPI<Extra> & Extra {
    const kind: Kind<TestFunction> = {
        register: registerTest,
        modifiers: { fails: { fails: true } },
        extend
    };

    return createAPI(kind, {}) as TestAPI<Extra> & Extra;
}

/** Declares a test, which passes unless its function throws or rejects */
export const it: TestAPI = createTestAPI(() => ({}));
export const test: TestAPI = it;

/** Declares a suite, whose function declares tests and other suites */
export const describe = createAPI<SuiteFunction>(
    { register: registerSuite, modifiers: {}, extend: () => ({}) },
    {}
) as SuiteAPI;
export const suite: SuiteAPI = describe;
