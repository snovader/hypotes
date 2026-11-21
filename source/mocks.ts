// Vitest's module mocks, on module.registerHooks, rather than node:test's
// `mock.module`, which needs a flag that NODE_OPTIONS can't pass, and can't
// keep the exports of the original. The preload, `hypotes/register`,
// installs the registry of the process on globalThis, where the members of
// `vi` and the code that its transform writes find it.
//
// While a module is mocked, its URL resolves to a module of the factory's
// exports, under a URL of its own for each mock, so that a mock that replaces
// another loads afresh, and `hypotes-actual:` followed by its URL resolves to
// the original. A module loads synchronously, so a factory that returns a
// promise settles before then: a transformed module waits for the factories
// before its imports and dynamic imports, where Vitest's runner waits for
// them as the mocked module loads. A factory's error surfaces where its
// module is imported, as Vitest's does.
//
// A mock can stand in for a package that isn't installed, or for an import
// that its package doesn't define, as Vitest's can. `import.meta.resolve`
// gives their specifiers no URL, so the URL of such a mock's original is
// `hypotes-package:` followed by the specifier, and an import of the
// specifier that fails to resolve, from any module, resolves to the mock.
// As with Vitest 5.1, a mock can't stand in for a file that isn't there,
// which fails to import as it does unmocked, or for a subpath that an
// installed package doesn't export: the call that mocks it throws, as
// `import.meta.resolve` does.
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
    LoadFnOutput,
    LoadHookContext,
    ResolveFnOutput,
    ResolveHookContext
} from 'node:module';

type Awaitable<T> = PromiseLike<T> | T;

/**
 * Makes the exports of a mocked module, from those of the original, if it
 * imports them
 */
export type MockFactoryWithHelper<M = unknown> = (
    importOriginal: <T extends M = M>() => Promise<T>
) => Awaitable<Partial<M>>;

/** A mocked module's exports, by name */
type Exports = Readonly<Record<string, unknown>>;

type Outcome = { readonly exports: Exports } | { readonly error: unknown };

type NextResolve = (
    specifier: string,
    context?: Partial<ResolveHookContext>
) => ResolveFnOutput;
type NextLoad = (
    url: string,
    context?: Partial<LoadHookContext>
) => LoadFnOutput;

/** The registry's key on globalThis, for the code of transformed modules */
export const MOCKS_KEY = 'hypotes.mocks';
const MOCKS = Symbol.for(MOCKS_KEY);

/** The scheme of each mocked module's URL: `hypotes-mock:<id>:<url>` */
const MOCK = 'hypotes-mock:';
/** The scheme of the URL that resolves to a mocked module's original */
const ACTUAL = 'hypotes-actual:';
/**
 * The scheme of the URL of a package that isn't installed, or an import that
 * isn't defined, which a mock stands in for: `hypotes-package:<specifier>`
 */
const PACKAGE = 'hypotes-package:';

/**
 * The drive of a Windows path, such as `C:\a.ts`, which parses as a URL whose
 * scheme is the drive's letter
 */
const DRIVE = /^[a-z]:/i;

/**
 * The mocks whose factories run the code that reads this, or started it: an
 * import from a factory doesn't wait for that factory, which waits for it
 */
const running = new AsyncLocalStorage<ReadonlySet<ModuleMock>>();

/** Imports the original of a mocked module */
function importOriginal<T>(url: string): Promise<T> {
    return import(ACTUAL + url) as Promise<T>;
}

/** A mock of a module, whose factory runs once */
class ModuleMock {
    /** The URL that the module resolves to while it's mocked */
    readonly url: string;
    readonly #original: string;
    readonly #factory: MockFactoryWithHelper;
    #ran = false;
    /** Resolves once the exports of a factory that returned a promise settle */
    #settling: Promise<void> | undefined;
    #outcome: Outcome | undefined;

    constructor(id: number, original: string, factory: MockFactoryWithHelper) {
        this.url = `${MOCK}${id}:${original}`;
        this.#original = original;
        this.#factory = factory;
    }

    /**
     * Runs the factory, unless it ran, and resolves once its exports have
     * settled, but for the factory's own code, which they wait for
     */
    run(): Promise<void> | undefined {
        const around = running.getStore();
        if (this.#ran) {
            return around?.has(this) ? undefined : this.#settling;
        }

        this.#ran = true;
        let exports: unknown;
        try {
            exports = running.run(new Set(around).add(this), () =>
                this.#factory(() => importOriginal(this.#original))
            );
        } catch (error) {
            this.#fail(error);
            return undefined;
        }

        if (typeof (exports as PromiseLike<unknown>)?.then === 'function') {
            this.#settling = this.#await(exports as PromiseLike<unknown>);
            return this.#settling;
        }

        this.#settle(exports);
        return undefined;
    }

    /** The factory's exports, for the mocked module, which loads now */
    exports(): Exports {
        void this.run();

        const outcome = this.#outcome;
        if (outcome == null) {
            throw new Error(
                `The factory of the mock of ${nameOf(this.#original)} returned a promise, which hadn't settled when the module was imported. A module that mocks modules waits for their factories before its imports, so import it from there, after the mock, or from a module that it imports. Mocks settle in the order of their calls, so mock a module that a factory imports before the mock of that factory.`
            );
        }
        if ('error' in outcome) {
            throw outcome.error;
        }

        return outcome.exports;
    }

    async #await(exports: PromiseLike<unknown>): Promise<void> {
        try {
            this.#settle(await exports);
        } catch (error) {
            this.#fail(error);
        }
    }

    #settle(exports: unknown): void {
        if (typeof exports !== 'object' || exports === null) {
            this.#outcome = {
                error: new TypeError(
                    `The factory of the mock of ${nameOf(this.#original)} returned ${String(exports)}, rather than an object of the module's exports. A default export is its "default" key.`
                )
            };
            return;
        }

        this.#outcome = { exports: exports as Exports };
    }

    #fail(error: unknown): void {
        this.#outcome = {
            error: new Error(
                `The factory of the mock of ${nameOf(this.#original)} failed. The factory of vi.mock() runs above the module's code, where the call is hoisted, so it can read only the variables that vi.hoisted() declares.`,
                { cause: error }
            )
        };
    }
}

/**
 * The module mocks of the process, which `hypotes/register` installs, with
 * hooks that resolve and load mocked modules
 */
export class ModuleMocks {
    /** The current mock of each mocked module, by the original's URL */
    readonly #mocks = new Map<string, ModuleMock>();
    /** Every mock, by its ID, which its module's URL holds */
    readonly #byId: ModuleMock[] = [];

    /** Installs the registry of the process, unless one is installed */
    static install(): ModuleMocks | undefined {
        const global = globalThis as { [MOCKS]?: ModuleMocks };
        if (global[MOCKS] != null) {
            return undefined;
        }

        const mocks = new ModuleMocks();
        global[MOCKS] = mocks;
        return mocks;
    }

    /** The registry of the process, which `method` needs */
    static installed(method: string): ModuleMocks {
        const mocks = (globalThis as { [MOCKS]?: ModuleMocks })[MOCKS];
        if (mocks == null) {
            throw new Error(
                `${method} needs the module mocks that node preloads with --import hypotes/register`
            );
        }

        return mocks;
    }

    /** Mocks the module at the URL, from the imports after this */
    mock(url: string, factory: MockFactoryWithHelper): void {
        const mock = new ModuleMock(this.#byId.length, url, factory);
        this.#byId.push(mock);
        this.#mocks.set(url, mock);
    }

    /** Ends the mock of the module at the URL, for the imports after this */
    unmock(url: string): void {
        this.#mocks.delete(url);
    }

    /**
     * Runs the factories of the mocks that haven't run, and resolves once
     * the exports of every factory have settled. A factory that this waits
     * for can import through `wrapDynamicImport`, which doesn't wait for it,
     * and runs the factories after it.
     */
    async settle(): Promise<void> {
        for (const mock of this.#mocks.values()) {
            await mock.run();
        }
    }

    /** Imports through `load`, after the factories of the mocks settle */
    async wrapDynamicImport<T>(load: () => Promise<T>): Promise<T> {
        await this.settle();
        return load();
    }

    /** The exports of a mock, for its module, which reads them as it runs */
    exportsOf(id: number): Exports {
        return this.#byId[id].exports();
    }

    /**
     * Resolves the path of a mock from the module whose `import.meta` this
     * gets, for the transform, which passes the URL to `vi`
     */
    resolvePath(meta: ImportMeta, path: string): string {
        try {
            return meta.resolve(path);
        } catch (error) {
            if (!namesNoPackage(error)) {
                throw error;
            }
            return PACKAGE + path;
        }
    }

    /** Resolves a mocked module to its mock, and an actual one to its URL */
    resolve(
        specifier: string,
        context: ResolveHookContext,
        nextResolve: NextResolve
    ): ResolveFnOutput {
        if (specifier.startsWith(ACTUAL)) {
            return { url: actualURL(specifier), shortCircuit: true };
        }

        let resolved: ResolveFnOutput;
        try {
            resolved = nextResolve(specifier, context);
        } catch (error) {
            const mock = namesNoPackage(error)
                ? this.#mocks.get(PACKAGE + specifier)
                : undefined;
            if (mock == null) {
                throw error;
            }
            return { url: mock.url, format: 'module', shortCircuit: true };
        }

        const mock = this.#mocks.get(resolved.url);

        return mock == null
            ? resolved
            : { url: mock.url, format: 'module', shortCircuit: true };
    }

    /** Loads a mock's module, which exports its factory's exports */
    load(
        url: string,
        context: LoadHookContext,
        nextLoad: NextLoad
    ): LoadFnOutput {
        if (!url.startsWith(MOCK)) {
            return nextLoad(url, context);
        }

        const id = Number(
            url.slice(MOCK.length, url.indexOf(':', MOCK.length))
        );
        const source = mockSource(id, this.#byId[id].exports());

        return { format: 'module', source, shortCircuit: true };
    }
}

/**
 * Whether the error of a resolution says that its specifier names no
 * package that's installed, or import that its package defines. That of a
 * file that isn't there has the file's URL.
 */
function namesNoPackage(error: unknown): boolean {
    const { code, url } = error as { code?: unknown; url?: unknown };

    return (
        (code === 'ERR_MODULE_NOT_FOUND' && url === undefined) ||
        code === 'ERR_PACKAGE_IMPORT_NOT_DEFINED'
    );
}

/**
 * The URL of the original that the specifier names, after `hypotes-actual:`,
 * which a package that isn't installed doesn't have
 */
function actualURL(specifier: string): string {
    const url = specifier.slice(ACTUAL.length);
    if (url.startsWith(PACKAGE)) {
        throw new Error(
            `Cannot import the original of '${nameOf(url)}', which isn't an installed package, or an import that its package defines`
        );
    }

    return url;
}

/**
 * The name of a mocked module in messages: its URL, or the specifier of a
 * package that isn't installed
 */
function nameOf(url: string): string {
    return url.startsWith(PACKAGE) ? url.slice(PACKAGE.length) : url;
}

/**
 * The source of a mock's module, which reads its exports from the registry.
 * Its names are strings, which any key can be.
 */
function mockSource(id: number, exports: Exports): string {
    const names = Object.keys(exports);
    const bindings = names.map(
        (name, index) => `e${index} = exports[${JSON.stringify(name)}]`
    );
    const specifiers = names.map(
        (name, index) => `e${index} as ${JSON.stringify(name)}`
    );

    return [
        `const exports = globalThis[Symbol.for(${JSON.stringify(MOCKS_KEY)})].exportsOf(${id});`,
        ...(bindings.length > 0 ? [`const ${bindings.join(', ')};`] : []),
        `export { ${specifiers.join(', ')} };`
    ].join('\n');
}

/**
 * The URL that the transform resolved a path to, or of the original, if it's
 * mocked: where it resolves to the mock's
 */
function urlOf(method: string, path: unknown): string {
    if (typeof path !== 'string' || !URL.canParse(path) || DRIVE.test(path)) {
        throw new TypeError(
            `${method} got ${typeof path === 'string' ? JSON.stringify(path) : typeof path}, rather than a URL that hypotes/register resolved its path to. It transforms the ES modules outside node_modules that call it, which it resolves the path from.`
        );
    }

    return path.startsWith(MOCK)
        ? path.slice(path.indexOf(':', MOCK.length) + 1)
        : path;
}

/** Mocks the module at the path, with the factory's exports */
function register(method: string, path: unknown, factory: unknown): string {
    const mocks = ModuleMocks.installed(method);
    const url = urlOf(method, path);
    if (typeof factory !== 'function') {
        throw new TypeError(
            `${method} takes a factory of the module's exports: hypotes doesn't mock a module's exports by itself, or from a __mocks__ directory`
        );
    }

    mocks.mock(url, factory as MockFactoryWithHelper);
    return url;
}

/**
 * Runs the factory, and returns what it returns. With `vi.mock()`, it's
 * hoisted above the module's imports, in the order of the calls, so that
 * the factory of a mock can read what it declares.
 */
export function hoisted<T>(factory: () => T): T {
    return factory();
}

/**
 * Mocks the module at the path, which resolves from the module that calls
 * this, for every import of it after this, with the exports that the factory
 * returns. It's hoisted above the module's imports, so they import the mock,
 * and its factory can read only what `vi.hoisted()` declares. The factory
 * runs once, before those imports or when the mock is first imported.
 */
export function mock(path: string, factory: MockFactoryWithHelper): void;
export function mock<T>(
    module: Promise<T>,
    factory: MockFactoryWithHelper<T>
): void;
export function mock(path: Promise<unknown> | string, factory: unknown): void {
    register('vi.mock()', path, factory);
}

/**
 * Mocks the module at the path, as `vi.mock()` does, but from where it's
 * called: for the dynamic imports after it. Disposing what it returns ends
 * the mock.
 */
export function doMock(
    path: string,
    factory: MockFactoryWithHelper
): Disposable;
export function doMock<T>(
    module: Promise<T>,
    factory: MockFactoryWithHelper<T>
): Disposable;
export function doMock(
    path: Promise<unknown> | string,
    factory: unknown
): Disposable {
    const url = register('vi.doMock()', path, factory);
    return {
        [Symbol.dispose]: (): void => {
            ModuleMocks.installed('vi.doMock()').unmock(url);
        }
    };
}

/**
 * Ends the mock of the module at the path, for the imports after it. It's
 * hoisted above the module's imports, which import the original.
 */
export function unmock(path: Promise<unknown> | string): void {
    ModuleMocks.installed('vi.unmock()').unmock(urlOf('vi.unmock()', path));
}

/**
 * Ends the mock of the module at the path, as `vi.unmock()` does, but from
 * where it's called: for the dynamic imports after it
 */
export function doUnmock(path: Promise<unknown> | string): void {
    ModuleMocks.installed('vi.doUnmock()').unmock(urlOf('vi.doUnmock()', path));
}

/** Imports the module at the path, rather than its mock, if it's mocked */
export function importActual<T = Record<string, unknown>>(
    path: string
): Promise<T> {
    // Whose hooks resolve the original
    ModuleMocks.installed('vi.importActual()');
    return importOriginal<T>(urlOf('vi.importActual()', path));
}
