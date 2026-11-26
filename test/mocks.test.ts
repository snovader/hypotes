import { sep } from 'node:path';
import { escape } from 'node:querystring';
import { afterEach, describe, expect, it, vi } from 'hypotes';
import { fc, it as property } from 'hypotes/fast-check';
import { values as automockedValues, fetchValue } from './fixtures/automocked.ts';
import data from './fixtures/data.json' with { type: 'json' };
import * as partial from './fixtures/partial.ts';
import type * as Shapes from './fixtures/shapes.ts';
import { describeValue, replaced } from './fixtures/uses-automocked.ts';
import { missing } from './fixtures/uses-package.ts';
import { quadruple } from './fixtures/uses.ts';
import original, * as values from './fixtures/values.ts';

const spies = vi.hoisted(() => ({ double: vi.fn((value: number) => value * 3) }));
const { label } = await vi.hoisted(async () => ({ label: await Promise.resolve('mocked') }));

vi.mock('./fixtures/values.ts', () => ({ default: label, double: spies.double, one: 2 }));
vi.mock(import('./fixtures/partial.ts'), async importOriginal => ({
    ...(await importOriginal()),
    replaced: () => 'mocked'
}));
vi.mock('querystring', () => ({ escape: (text: string) => `escaped ${text}` }));
vi.mock('node:path', () => ({ sep: 'mocked' }));
vi.unmock('path');
vi.mock('not-installed-package', () => ({ missing: 'mocked' }));
// A factory whose original imports a module that a later call automocks
vi.mock(import('./fixtures/uses-automocked.ts'), async importOriginal => ({
    ...(await importOriginal()),
    replaced: () => 'mocked'
}));
vi.mock('./fixtures/automocked.ts');

/** A name of a package, or a path within one */
const word = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);

/** A package that isn't installed, or an import that isn't defined */
const unresolved = fc.oneof(
    fc.tuple(fc.option(word), word, fc.option(word)).map(packageSpecifier),
    word.map(name => `#not-defined-${name}`)
);

/** The specifier of a package that isn't installed, or a path within it */
function packageSpecifier([scope, name, subpath]: [string | null, string, string | null]): string {
    const specifier = scope == null ? `not-installed-${name}` : `@not-installed-${scope}/${name}`;
    return subpath == null ? specifier : `${specifier}/${subpath}`;
}

describe('vi.mock', () => {
    it("should give the module's imports the factory's exports", () => {
        expect([original, values.one, values.double(1)]).toEqual(['mocked', 2, 3]);
    });

    it('should run an awaited vi.hoisted() before the factories that read it', () => {
        expect([label, original]).toEqual(['mocked', 'mocked']);
    });

    it('should end a mock with a hoisted vi.unmock(), by any specifier', () => {
        expect(sep).not.toBe('mocked');
    });

    it('should give the mock to the modules that the module imports', () => {
        expect(quadruple(1)).toBe(9);
        expect(spies.double).toHaveBeenCalledWith(3);
    });

    it("should keep the original's exports that the factory returns", () => {
        expect([partial.kept(), partial.replaced()]).toEqual(['kept', 'mocked']);
    });

    it('should mock a built-in module, by any specifier that resolves to it', () => {
        expect(escape('a')).toBe('escaped a');
    });

    it("should mock a package that isn't installed, for the modules that import it", () => {
        expect(missing).toBe('mocked');
    });

    it('should type a mocked import as its mock, with vi.mocked', () => {
        vi.mocked(values.double).mockReturnValueOnce(10);

        expect(vi.mocked(values.double)).toBe(values.double);
        expect(values.double(1)).toBe(10);
    });

    it("should reject a module whose vi isn't from hypotes, since its mocks would come first", async () => {
        const error: unknown = await import('./fixtures/foreign-vi.ts').catch(
            (error: unknown) => error
        );

        expect(error).toBeInstanceOf(SyntaxError);
        expect(String(error)).toContain('imports vi from "./vi.ts"');
    });

    it("should give the mock to the module's exports of the mocked module", async () => {
        const reexports = await import('./fixtures/reexports.ts');

        expect([
            reexports.renamed,
            reexports.name(),
            reexports['a string'],
            reexports.all.one
        ]).toEqual(['mocked', 'mocked', 2, 2]);
        expect(Object.keys(reexports).sort()).toEqual(['a string', 'all', 'name', 'renamed']);
    });

    it('should reject a module that exports every export of another, which would load first', async () => {
        const error: unknown = await import('./fixtures/exports-all.ts').catch(
            (error: unknown) => error
        );

        expect(error).toBeInstanceOf(SyntaxError);
        expect(String(error)).toContain("exports every export of './later.ts'");
    });

    it('should reject a statement that would hoist more than vi.hoisted()', async () => {
        const error: unknown = await import('./fixtures/declares.ts').catch(
            (error: unknown) => error
        );

        expect(error).toBeInstanceOf(SyntaxError);
        expect(String(error)).toMatch(
            /vi\.hoisted\(\) at .*declares\.ts:6:15\n.*declares\.ts:8:25\n/
        );
    });

    it('should import a module with attributes', () => {
        expect(data).toEqual({ value: 1 });
    });

    it('should leave the original to vi.importActual', async () => {
        const actual = await vi.importActual('./fixtures/values.ts');
        expect([actual.default, actual.one]).toEqual(['original', 1]);
    });

    it("should reject the original of a package that isn't installed", async () => {
        await expect(vi.importActual('not-installed-package')).rejects.toThrow(
            "Cannot import the original of 'not-installed-package'"
        );
    });

    it('should find the calls that take type arguments, in a module with no others', async () => {
        const typed = await import('./fixtures/typed.ts');
        const actual = await typed.actual();

        expect([typed.hoistedFirst, actual.one]).toEqual([true, 1]);
    });
});

describe('vi.doMock', () => {
    afterEach(() => {
        vi.doUnmock('./fixtures/later.ts');
        vi.doUnmock('./fixtures/uses-later.ts');
    });

    it('should mock the module for the dynamic imports after it, until disposed', async () => {
        const before = await import('./fixtures/later.ts');
        const mocked = vi.doMock('./fixtures/later.ts', () => ({ value: () => 'mocked' }));
        const during = await import('./fixtures/later.ts');
        mocked[Symbol.dispose]();
        const after = await import('./fixtures/later.ts');

        expect([before.value(), during.value(), after.value()]).toEqual([
            'original',
            'mocked',
            'original'
        ]);
    });

    it('should end the mock with vi.doUnmock', async () => {
        vi.doMock('./fixtures/later.ts', () => ({ value: () => 'mocked' }));
        vi.doUnmock('./fixtures/later.ts');
        const { value } = await import('./fixtures/later.ts');

        expect(value()).toBe('original');
    });

    it('should replace a mock of the module with a later one', async () => {
        vi.doMock('./fixtures/later.ts', () => ({ value: () => 'first' }));
        const first = await import('./fixtures/later.ts');
        vi.doMock('./fixtures/later.ts', () => ({ value: () => 'second' }));
        const second = await import('./fixtures/later.ts');

        expect([first.value(), second.value()]).toEqual(['first', 'second']);
    });

    it('should wait for a factory that returns a promise', async () => {
        vi.doMock(import('./fixtures/later.ts'), async importOriginal => ({
            ...(await importOriginal()),
            value: () => 'awaited'
        }));
        const { value } = await import('./fixtures/later.ts');

        expect(value()).toBe('awaited');
    });

    it('should wait for a factory that returns a promise, for each import at once', async () => {
        vi.doMock(import('./fixtures/later.ts'), async importOriginal => ({
            ...(await importOriginal()),
            value: () => 'awaited'
        }));
        const [first, second] = await Promise.all([
            import('./fixtures/later.ts'),
            import('./fixtures/later.ts')
        ]);

        expect([first.value(), second.value()]).toEqual(['awaited', 'awaited']);
    });

    it("should leave a factory's own imports from waiting for it", async () => {
        vi.doMock('./fixtures/later.ts', async () => {
            const { kept } = await import('./fixtures/partial.ts');
            return { value: kept };
        });
        const { value } = await import('./fixtures/later.ts');

        expect(value()).toBe('kept');
    });

    it('should wait in importOriginal for a mock that the original imports, whatever the order of the calls', async () => {
        vi.doMock(import('./fixtures/uses-later.ts'), async importOriginal => ({
            ...(await importOriginal())
        }));
        vi.doMock(import('./fixtures/later.ts'), () => Promise.resolve({ value: () => 'awaited' }));
        const { describeLater } = await import('./fixtures/uses-later.ts');

        expect(describeLater()).toBe('later: awaited');
    });

    property.prop([unresolved])(
        "should mock a package that isn't installed, or an import that isn't defined, until the mock ends",
        async specifier => {
            const before: unknown = await import(specifier).catch((error: unknown) => error);
            const mocked = vi.doMock(specifier, () => ({ value: specifier }));
            const during = (await import(specifier)) as { value: string };
            mocked[Symbol.dispose]();
            const after: unknown = await import(specifier).catch((error: unknown) => error);

            expect(before).toBeInstanceOf(Error);
            expect(during.value).toBe(specifier);
            expect(after).toEqual(before);
        }
    );

    it("should leave a file that isn't there to fail to import, as Vitest does", async () => {
        const path = './fixtures/missing.ts';
        const mocked = vi.doMock(path, () => ({ value: 'mocked' }));
        const error: unknown = await import(path).catch((error: unknown) => error);
        mocked[Symbol.dispose]();

        expect(error).toMatchObject({ code: 'ERR_MODULE_NOT_FOUND' });
    });

    property.prop([fc.dictionary(fc.string(), fc.anything())])(
        "should export the factory's exports, by any name",
        async exports => {
            vi.doMock('./fixtures/later.ts', () => exports);
            const namespace: Record<string, unknown> = await import('./fixtures/later.ts');

            const names = Object.keys(exports);
            // V8 lists the names that are indices first
            expect(Object.keys(namespace).sort()).toEqual(names.toSorted());
            for (const name of names) {
                expect(namespace[name], name).toBe(exports[name]);
            }
        }
    );

    it("should reject the module's import if the factory throws", async () => {
        vi.doMock('./fixtures/later.ts', () => {
            throw new Error('factory');
        });
        const error: unknown = await import('./fixtures/later.ts').catch((error: unknown) => error);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).cause).toEqual(new Error('factory'));
    });

    it("should name a package that isn't installed in the error of its mock's factory", async () => {
        const specifier = 'not-installed-package/failing';
        const mocked = vi.doMock(specifier, () => {
            throw new Error('factory');
        });
        const error: unknown = await import(specifier).catch((error: unknown) => error);
        mocked[Symbol.dispose]();

        expect(String(error)).toContain(`The factory of the mock of ${specifier} failed`);
    });

    it("should reject the module's import if the factory returns no object", async () => {
        vi.doMock('./fixtures/later.ts', () => 'exports' as never);

        await expect(import('./fixtures/later.ts')).rejects.toThrow(TypeError);
    });

    it('should reject an import that comes before a factory that returns a promise settles', async () => {
        const { load } = await import('./fixtures/importer.ts');
        vi.doMock('./fixtures/later.ts', () => Promise.resolve({ value: () => 'settled' }));

        await expect(load()).rejects.toThrow("hadn't settled");
    });

    it('should throw for a path that hypotes/register did not resolve', () => {
        // Through another name, which the transform doesn't look for
        const { doMock } = vi;
        expect(() => doMock('./fixtures/later.ts', () => ({}))).toThrow(TypeError);
    });

    property.prop([fc.stringMatching(/^[A-Za-z]:[\\/][\w\\/.-]*$/)])(
        'should throw for a Windows path, which parses as a URL whose scheme is its drive',
        path => {
            const { doMock } = vi;
            expect(() => doMock(path, () => ({}))).toThrow(TypeError);
        }
    );
});

describe('vi.mock without a factory', () => {
    afterEach(() => {
        vi.doUnmock('./fixtures/shapes.ts');
        vi.doUnmock('node:os');
        vi.doUnmock('./fixtures/list.json');
        vi.doUnmock('./fixtures/fails.ts');
        vi.doUnmock('./fixtures/cycle.ts');
        vi.doUnmock('./fixtures/later.ts');
    });

    it("should mock the original's exports, and give them to the modules that import it", () => {
        vi.mocked(fetchValue).mockReturnValueOnce('mocked');

        expect(vi.isMockFunction(fetchValue)).toBe(true);
        expect([describeValue(), describeValue()]).toEqual(['value: mocked', 'value: undefined']);
        expect(automockedValues).toEqual([]);
    });

    it('should load the original after the mocks that it imports, whatever the order of the calls', () => {
        expect([replaced(), describeValue()]).toEqual(['mocked', 'value: undefined']);
    });

    it('should mock functions to return undefined, a default export and re-exports too', async () => {
        vi.doMock('./fixtures/shapes.ts');
        const shapes = await import('./fixtures/shapes.ts');

        expect([shapes.add(1, 2), shapes.default('a'), shapes.reexported()]).toEqual([
            undefined,
            undefined,
            undefined
        ]);
        expect(shapes.add).toHaveBeenCalledWith(1, 2);
        expect(vi.isMockFunction(shapes.reexported)).toBe(true);
    });

    it('should keep primitives, empty arrays, and mock objects deeply', async () => {
        vi.doMock('./fixtures/shapes.ts');
        const shapes = await import('./fixtures/shapes.ts');
        const actual = await vi.importActual<typeof Shapes>('./fixtures/shapes.ts');

        expect([shapes.count, shapes.label, shapes.nothing]).toEqual([1, 'label', null]);
        expect([shapes.list, shapes.settings.items]).toEqual([[], []]);
        expect(shapes.settings.depth.value).toBe(1);
        expect(shapes.settings.depth.read()).toBeUndefined();
        expect(shapes.settings).not.toBe(actual.settings);
        expect(actual.list).toEqual([1, 2]);
    });

    it('should mock a class, its methods, its static members and its getters', async () => {
        vi.doMock('./fixtures/shapes.ts');
        const { Counter } = await import('./fixtures/shapes.ts');
        const counter = new Counter();

        expect(counter).toBeInstanceOf(Counter);
        expect([counter.value, counter.increment(), counter.doubled]).toEqual([
            undefined,
            undefined,
            undefined
        ]);
        expect([Counter.start, Counter.create()]).toEqual([1, undefined]);
        expect(vi.mocked(Counter).mock.instances).toEqual([counter]);
        // oxlint-disable-next-line typescript/unbound-method -- The mock is read, not called
        expect(Counter.prototype.increment).toHaveBeenCalledTimes(1);
    });

    it('should give vi.mocked() mocks whose implementations can be set', async () => {
        vi.doMock('./fixtures/shapes.ts');
        const { add, Counter } = await import('./fixtures/shapes.ts');
        vi.mocked(add).mockReturnValue(10);
        // oxlint-disable-next-line typescript/unbound-method -- The mock is read, not called
        vi.mocked(Counter.prototype.increment).mockReturnValue(5);

        expect([add(1, 2), new Counter().increment()]).toEqual([10, 5]);
    });

    it('should keep the implementations with spy, and record their calls', async () => {
        vi.doMock('./fixtures/shapes.ts', { spy: true });
        const shapes = await import('./fixtures/shapes.ts');
        const counter = new shapes.Counter();

        expect([shapes.add(1, 2), shapes.default('a'), shapes.reexported()]).toEqual([
            3,
            'hello a',
            'hello'
        ]);
        expect([counter.increment(), counter.doubled, shapes.list]).toEqual([2, 4, [1, 2]]);
        expect(shapes.add).toHaveBeenCalledWith(1, 2);
        // oxlint-disable-next-line typescript/unbound-method -- The mock is read, not called
        expect(counter.increment).toHaveBeenCalledTimes(1);
    });

    it('should automock with options that leave out spy, as Vitest does', async () => {
        vi.doMock('./fixtures/shapes.ts', {});
        const { add } = await import('./fixtures/shapes.ts');

        expect(add(1, 2)).toBeUndefined();
    });

    it('should leave the original to vi.importActual', async () => {
        vi.doMock('./fixtures/shapes.ts');
        const actual = await vi.importActual<typeof Shapes>('./fixtures/shapes.ts');

        expect(actual.add(1, 2)).toBe(3);
        expect(vi.isMockFunction(actual.add)).toBe(false);
    });

    it('should mock a built-in module', async () => {
        vi.doMock('node:os');
        const os = await import('node:os');

        expect(vi.isMockFunction(os.platform)).toBe(true);
        expect([os.platform(), os.default.platform()]).toEqual([undefined, undefined]);
        expect(os.EOL).toBe(os.default.EOL);
    });

    it('should mock JSON, whose original it imports with its type', async () => {
        vi.doMock('./fixtures/list.json');
        const list = await import('./fixtures/list.json', { with: { type: 'json' } });

        expect(list.default).toEqual({ items: [], name: 'list' });
    });

    it("should reject the module's import with the original's error, if it fails to load", async () => {
        vi.doMock('./fixtures/fails.ts');

        await expect(import('./fixtures/fails.ts')).rejects.toThrow('fails.ts failed to load');
    });

    it('should reject a mock that a module that the original imports imports back', async () => {
        vi.doMock('./fixtures/cycle.ts');

        await expect(import('./fixtures/cycle.ts')).rejects.toThrow(
            'was imported as its exports were made'
        );
    });

    it("should reject an import that comes before the original's exports settle", async () => {
        const { load } = await import('./fixtures/importer.ts');
        vi.doMock('./fixtures/later.ts');

        await expect(load()).rejects.toThrow("hadn't settled");
    });
});

describe('vi.importMock', () => {
    afterEach(() => {
        vi.doUnmock('./fixtures/shapes.ts');
    });

    it("should import a module that isn't mocked, with its exports automocked", async () => {
        const mocked = await vi.importMock<typeof Shapes>('./fixtures/shapes.ts');
        const shapes = await import('./fixtures/shapes.ts');

        expect(mocked.add(1, 2)).toBeUndefined();
        expect(mocked.list).toEqual([]);
        expect(shapes.add(1, 2)).toBe(3);
    });

    it('should mock the exports anew each time, as Vitest does', async () => {
        const first = await vi.importMock<typeof Shapes>('./fixtures/shapes.ts');
        const second = await vi.importMock<typeof Shapes>('./fixtures/shapes.ts');

        expect(first.add).not.toBe(second.add);
    });

    it('should mock the exports as the mock of the module does, with spy', async () => {
        vi.doMock('./fixtures/shapes.ts', { spy: true });
        const mocked = await vi.importMock<typeof Shapes>('./fixtures/shapes.ts');
        const shapes = await import('./fixtures/shapes.ts');

        expect(mocked.add(1, 2)).toBe(3);
        expect(vi.isMockFunction(mocked.add)).toBe(true);
        expect(mocked.add).not.toBe(shapes.add);
    });

    it("should give the exports of a mock's factory", async () => {
        const mocked = await vi.importMock<typeof values>('./fixtures/values.ts');

        expect([mocked.default, mocked.one]).toEqual(['mocked', 2]);
    });

    it("should reject a package that isn't installed or mocked", async () => {
        await expect(vi.importMock('not-installed-package/other')).rejects.toThrow(
            "Cannot import the original of 'not-installed-package/other'"
        );
    });
});
