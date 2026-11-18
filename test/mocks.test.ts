import { sep } from 'node:path';
import { escape } from 'node:querystring';
import { afterEach, describe, expect, it, vi } from 'hypotes';
import { fc, it as property } from 'hypotes/fast-check';
import data from './fixtures/data.json' with { type: 'json' };
import * as partial from './fixtures/partial.ts';
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

    it('should type a mocked import as its mock, with vi.mocked', () => {
        vi.mocked(values.double).mockReturnValueOnce(10);

        expect(vi.mocked(values.double)).toBe(values.double);
        expect(values.double(1)).toBe(10);
    });

    it("should reject a module whose vi isn't from hypotes, since its mocks would come first", async () => {
        const error: unknown = await import('./fixtures/foreignVi.ts').catch(
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
        expect(Object.keys(reexports).toSorted()).toEqual(['a string', 'all', 'name', 'renamed']);
    });

    it('should reject a module that exports every export of another, which would load first', async () => {
        const error: unknown = await import('./fixtures/exportsAll.ts').catch(
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
            /vi\.hoisted\(\) at .*declares\.ts:6:15\n.*declares\.ts:8:25\n/u
        );
    });

    it('should import a module with attributes', () => {
        expect(data).toEqual({ value: 1 });
    });

    it('should leave the original to vi.importActual', async () => {
        const actual = await vi.importActual('./fixtures/values.ts');
        expect([actual.default, actual.one]).toEqual(['original', 1]);
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

    it("should mock a file that isn't there, until the mock ends", async () => {
        const path = './fixtures/missing.ts';
        const mocked = vi.doMock(path, () => ({ value: 'mocked' }));
        const during = (await import(path)) as { value: string };
        mocked[Symbol.dispose]();

        expect(during.value).toBe('mocked');
        await expect(import(path)).rejects.toThrow('Cannot find module');
    });

    property.prop([fc.dictionary(fc.string(), fc.anything())])(
        "should export the factory's exports, by any name",
        async exports => {
            vi.doMock('./fixtures/later.ts', () => exports);
            const namespace: Record<string, unknown> = await import('./fixtures/later.ts');

            const names = Object.keys(exports);
            // V8 lists the names that are indices first
            expect(Object.keys(namespace).toSorted()).toEqual(names.toSorted());
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

    it('should throw without a factory, since hypotes mocks exports only from one', () => {
        const doMock = vi.doMock as unknown as (path: string) => Disposable;
        expect(() => doMock(import.meta.resolve('./fixtures/later.ts'))).toThrow('takes a factory');
    });
});
