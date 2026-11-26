import { describe, expect, it } from 'hypotes';

interface Shape {
    readonly kind: string;
    readonly size: number;
}

type Pair<A, B> = [A, B];

const shape = <T extends Shape>(value: T): T => value;

it('scalars', () => {
    expect(1).toMatchInlineSnapshot();
    expect('text').toMatchInlineSnapshot();
    expect('back`tick ${dollar} \\ slash').toMatchInlineSnapshot();
    expect('one\ntwo').toMatchInlineSnapshot();
});

it('objects', () => {
    const pair: Pair<string, number> = ['a', 1];
    expect(shape({ kind: 'square', size: 2 }) satisfies Shape).toMatchInlineSnapshot();
    expect(pair as readonly unknown[]).toMatchInlineSnapshot();
    expect<Shape>({ kind: 'k', size: 1 }).toMatchInlineSnapshot();
});

it('errors', async () => {
    expect(() => {
        throw new Error('thrown');
    }).toThrowErrorMatchingInlineSnapshot();
    await expect(Promise.reject(new Error('rejected'))).rejects.toThrowErrorMatchingInlineSnapshot();
    await expect(Promise.resolve({ ok: true })).resolves.toMatchInlineSnapshot();
});

it('property matchers', () => {
    expect({ id: Math.random(), name: 'n' }).toMatchInlineSnapshot({ id: expect.any(Number) });
    expect({ id: Math.random(), name: 'm' }).toMatchInlineSnapshot(
        { id: expect.any(Number) }
    );
});

describe('nested', () => {
	it('tabs', () => {
		expect({ a: [1, 2] }).toMatchInlineSnapshot();
	});

    it.each([1, 1])('same place %i', value => {
        expect(value).toMatchInlineSnapshot();
    });

    it('in a callback', () => {
        [1].forEach(value => {
            expect({ value }).toMatchInlineSnapshot();
        });
    });
});

it('kept', () => {
    expect({ a: 1 }).toMatchInlineSnapshot(`
      {
        "a": 1,
      }
    `);
    expect('kept').toMatchInlineSnapshot(`"kept"`);
});

it('two on a line', () => { expect(1).toMatchInlineSnapshot(); expect(2).toMatchInlineSnapshot(); });

it('spread over lines', () => {
    expect([1, 2, 3])
        .toMatchInlineSnapshot();
    expect(
        'x'
    ).toMatchInlineSnapshot(
        // a comment
    );
});
