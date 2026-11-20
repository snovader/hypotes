import { afterEach, describe, expect, it, vi } from 'hypotes';
import { fc, it as property } from 'hypotes/fast-check';

/** A name that no global and no environment variable has */
const unused = fc.stringMatching(/^[a-z]{1,8}$/u).map(name => `hypotes_stub_${name}`);

/** A value that an environment variable keeps as it's set, on each platform */
const value = fc.stringMatching(/^[ -~]{0,16}$/u);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('vi.stubGlobal', () => {
    property.prop([unused, fc.anything(), fc.anything()])(
        'should define a global, until vi.unstubAllGlobals() deletes it',
        (name, first, second) => {
            vi.stubGlobal(name, first);
            vi.stubGlobal(name, second);
            const stubbed: unknown = Reflect.get(globalThis, name);
            vi.unstubAllGlobals();

            expect(Object.is(stubbed, second)).toBe(true);
            expect(name in globalThis).toBe(false);
        }
    );

    it('should define a global by a symbol', () => {
        const key = Symbol('stub');

        vi.stubGlobal(key, 1);
        const stubbed: unknown = Reflect.get(globalThis, key);
        vi.unstubAllGlobals();

        expect(stubbed).toBe(1);
        expect(key in globalThis).toBe(false);
    });

    it('should leave a global as it was before its first stub, accessors too', () => {
        const fetchBefore = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
        const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        const stub = vi.fn<typeof fetch>();

        vi.stubGlobal('fetch', () => undefined);
        vi.stubGlobal('fetch', stub);
        vi.stubGlobal('navigator', { userAgent: 'stub' });
        const stubbed = [fetch, navigator.userAgent];
        vi.unstubAllGlobals();

        expect(stubbed).toEqual([stub, 'stub']);
        expect(Object.getOwnPropertyDescriptor(globalThis, 'fetch')).toEqual(fetchBefore);
        expect(Object.getOwnPropertyDescriptor(globalThis, 'navigator')).toEqual(navigatorBefore);
    });

    it('should define a property that can be assigned, deleted, and listed', () => {
        vi.stubGlobal('hypotes_stub', 1);

        expect(Object.getOwnPropertyDescriptor(globalThis, 'hypotes_stub')).toEqual({
            value: 1,
            writable: true,
            configurable: true,
            enumerable: true
        });
    });

    it('should return vi, as vi.unstubAllGlobals() does', () => {
        expect(vi.stubGlobal('hypotes_stub', 1)).toBe(vi);
        expect(vi.unstubAllGlobals()).toBe(vi);
    });
});

describe('vi.stubEnv', () => {
    property.prop([unused, value, value])(
        'should set a variable, until vi.unstubAllEnvs() deletes it',
        (name, first, second) => {
            vi.stubEnv(name, first);
            vi.stubEnv(name, second);
            const stubbed = process.env[name];
            vi.unstubAllEnvs();

            expect(stubbed).toBe(second);
            expect(name in process.env).toBe(false);
        }
    );

    property.prop([unused, value, fc.option(value, { nil: undefined })])(
        'should leave a variable as it was before its first stub',
        (name, before, stub) => {
            process.env[name] = before;

            vi.stubEnv(name, stub);
            vi.stubEnv(name, 'again');
            vi.unstubAllEnvs();
            const after = process.env[name];
            delete process.env[name];

            expect(after).toBe(before);
        }
    );

    it('should delete a variable that is stubbed as undefined', () => {
        process.env.hypotes_stub = 'set';

        vi.stubEnv('hypotes_stub', undefined);
        const stubbed = 'hypotes_stub' in process.env;
        vi.unstubAllEnvs();
        const after = process.env.hypotes_stub;
        delete process.env.hypotes_stub;

        expect(stubbed).toBe(false);
        expect(after).toBe('set');
    });

    it.each([
        ['PROD', true, '1'],
        ['DEV', false, ''],
        ['SSR', true, '1']
    ] as const)('should set %s from the boolean %s, as %j', (name, value, expected) => {
        vi.stubEnv(name, value);

        expect(process.env[name]).toBe(expected);
    });

    it('should return vi, as vi.unstubAllEnvs() does', () => {
        expect(vi.stubEnv('hypotes_stub', 'set')).toBe(vi);
        expect(vi.unstubAllEnvs()).toBe(vi);
    });
});
