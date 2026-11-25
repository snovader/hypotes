// Vitest's automocker: `vi.mockObject()`, and the exports of the module mocks
// that `vi.mock()` makes without a factory. @vitest/mocker's `mockObject`
// mocks them, with @vitest/spy's mocks, as Vitest's own `vi.mockObject` does:
// a function becomes a mock that returns undefined, a class a mock whose
// methods are mocks, an array becomes empty, an object a copy whose
// properties are mocked, and other values stay. With `spy`, each mock keeps
// its implementation, and arrays their elements, and an object stays itself,
// with its functions replaced by mocks: those of a module mocked with `spy`
// are the original's too, which `vi.importActual()` gives.
//
// @vitest/mocker loads once a test file automocks, so that one that doesn't
// leaves it out. Only its main entry point loads, which has the automocker
// and no transform: the others need Vite, or parse modules. @vitest/spy loads
// then too, as the copy that `vi` imports, so that the preload, which
// imports this, loads nothing of Vitest's in a process that doesn't automock.
import { createRequire } from 'node:module';
import type * as VitestMocker from '@vitest/mocker';
import type * as VitestSpy from '@vitest/spy';

/**
 * How `vi.mock()` mocks a module without a factory, and `vi.mockObject()` an
 * object: with `spy`, the mocks keep their implementations
 */
export type ModuleMockOptions = VitestMocker.ModuleMockOptions;

type Key = string | symbol;

interface Dependencies {
    readonly mockObject: typeof VitestMocker.mockObject;
    readonly createMockInstance: typeof VitestSpy.createMockInstance;
}

const require = createRequire(import.meta.url);
let dependencies: Dependencies | undefined;

/** @vitest/mocker's automocker and @vitest/spy's mocks, once a test automocks */
function loadDependencies(): Dependencies {
    if (dependencies == null) {
        const { mockObject } = require('@vitest/mocker') as typeof VitestMocker;
        const { createMockInstance } =
            require('@vitest/spy') as typeof VitestSpy;
        dependencies = { mockObject, createMockInstance };
    }

    return dependencies;
}

/**
 * Mocks the properties of `object` into `mocked`, and returns it. Vitest
 * passes the constructors of the test's realm, which here is Node's own.
 */
function mockInto(
    object: Record<Key, unknown>,
    mocked: Record<Key, unknown>,
    options: ModuleMockOptions | undefined
): Record<Key, unknown> {
    const { mockObject, createMockInstance } = loadDependencies();

    return mockObject(
        {
            type: options?.spy ? 'autospy' : 'automock',
            globalConstructors: { Object, Function, RegExp, Array, Map },
            createMockInstance
        },
        object,
        mocked
    );
}

/**
 * The exports of a module, mocked, as an object without a prototype, which a
 * module's namespace is, or one that has Object's, as `vi.importMock()`
 * gives
 */
export function mockExports(
    original: object,
    options: ModuleMockOptions | undefined,
    prototype: object | null
): Record<string, unknown> {
    const mocked = Object.create(prototype) as Record<Key, unknown>;
    return mockInto(original as Record<Key, unknown>, mocked, options);
}

/**
 * Mocks the value deeply, as `vi.mock()` mocks a module's exports without a
 * factory, and returns the mock. Without `spy`, the value stays as it was.
 * With it, the value is the mock, whose functions are replaced by mocks in
 * place, as Vitest's are.
 */
export function mockObject<T>(
    value: T,
    options?: ModuleMockOptions
): VitestSpy.MaybeMockedDeep<T> {
    return mockInto({ value }, {}, options)
        .value as VitestSpy.MaybeMockedDeep<T>;
}
