import { describe, expect, it, vi } from 'hypotes';

// How a test file types the matchers that it adds
declare module '@vitest/expect' {
    interface Matchers<R> {
        toBeEven: () => R;
    }
}

expect.extend({
    toBeEven(received: unknown) {
        return {
            pass: typeof received === 'number' && received % 2 === 0,
            message: () => `expected ${String(received)} to be even`
        };
    }
});

/** Rows that each print on a line of their own, more than a diff compares */
const ROWS = Array.from({ length: 5000 }, (_, index) => ({ index, name: 'row' }));

/** The message of the error that the function throws */
function messageOf(fn: () => void): string {
    try {
        fn();
    } catch (error) {
        return (error as Error).message;
    }

    throw new Error('Expected the function to throw');
}

describe('expect', () => {
    it('should add matchers with extend', () => {
        expect(2).toBeEven();
        expect(3).not.toBeEven();
        expect(() => expect(3).toBeEven()).toThrow('expected 3 to be even');
    });

    it('should add asymmetric matchers with extend', () => {
        // Asymmetric matchers are typed as any, which values take as unknown
        const even: unknown = expect.toBeEven();
        const odd: unknown = expect.not.toBeEven();

        expect({ count: 4 }).toEqual({ count: even });
        expect({ count: 3 }).toEqual({ count: odd });
    });

    it("should have the matchers that Vitest's expect adds", () => {
        expect(2).toBeOneOf([1, 2]);
        expect(2).toSatisfy((value: number) => value > 1);
    });

    it('should have the asymmetric matchers', () => {
        const number: unknown = expect.any(Number);
        const matching: unknown = expect.stringMatching(/b/u);
        const containing: unknown = expect.arrayContaining([2]);
        const anything: unknown = expect.anything();

        expect({ a: 1, b: 'b', c: [1, 2] }).toEqual({ a: number, b: matching, c: containing });
        expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: anything }));
    });

    it("should fail with expect.fail, which Vitest's expect has from chai's", () => {
        expect(() => expect.fail('a message')).toThrow('a message');
        expect(messageOf(() => expect.fail(1, 2, 'differ', '>'))).toBe('differ');
    });

    it("should check Vitest's spies", () => {
        const spy = vi.fn<(value: string) => void>();
        spy('a');

        expect(spy).toHaveBeenCalledExactlyOnceWith('a');
        expect(vi.isMockFunction(spy)).toBe(true);
    });

    it('should clear, reset and restore every spy, and return vi', () => {
        const target = { method: (): string => 'original' };
        const spy = vi.spyOn(target, 'method').mockReturnValue('mocked');
        target.method();

        const cleared = vi.clearAllMocks();
        const calls = spy.mock.calls.length;
        const restored = vi.resetAllMocks().restoreAllMocks();

        expect([cleared, restored]).toEqual([vi, vi]);
        expect([calls, target.method(), vi.isMockFunction(target.method)]).toEqual([
            0,
            'original',
            false
        ]);
    });

    it('should add a diff to the message of a matcher that compares values', () => {
        const message = messageOf(() => {
            expect({ a: [1, -0], b: 'same' }).toStrictEqual({ a: [1, 0], b: 'same' });
        });

        expect(message).toContain(
            "+ actual - expected\n\n+ { a: [ 1, -0 ], b: 'same' }\n- { a: [ 1, 0 ], b: 'same' }"
        );
    });

    it('should add no diff to the message of a matcher whose values print the same', () => {
        const message = messageOf(() => {
            expect({ a: 1 }).not.toEqual({ a: 1 });
        });

        expect(message).toBe('expected { a: 1 } to not deeply equal { a: 1 }');
    });

    it('should show the lines of large values that differ, with those around them', () => {
        const message = messageOf(() => {
            expect(ROWS.with(4000, { index: -1, name: 'row' })).toEqual(ROWS);
        });

        expect(message).toContain(
            [
                '+ actual - expected',
                '',
                '  ...',
                "    { index: 3997, name: 'row' },",
                "    { index: 3998, name: 'row' },",
                "    { index: 3999, name: 'row' },",
                "+   { index: -1, name: 'row' },",
                "-   { index: 4000, name: 'row' },",
                "    { index: 4001, name: 'row' },",
                "    { index: 4002, name: 'row' },",
                "    { index: 4003, name: 'row' },",
                '  ...'
            ].join('\n')
        );
    });

    it('should cut the diff of large values whose lines all differ', () => {
        const others = ROWS.map(({ index }) => ({ index: -1 - index, name: 'row' }));
        const lines = messageOf(() => {
            expect(others).toEqual(ROWS);
        }).split('\n');

        expect(lines).toContain("+   { index: -1, name: 'row' },");
        expect(lines).toContain("-   { index: 0, name: 'row' },");
        expect(lines.at(-1)).toBe('  ...');
        expect(lines.length).toBeLessThan(ROWS.length);
    });
});
