import { describe, expect, it, test, vi } from 'hypotes';

class Point {
    readonly x: number;
    readonly y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
}

it('primitives', () => {
    expect(1).toMatchSnapshot();
    expect('text').toMatchSnapshot();
    expect(null).toMatchSnapshot();
    expect(undefined).toMatchSnapshot();
    expect(12n).toMatchSnapshot();
    expect(-0).toMatchSnapshot();
});

it('strings', () => {
    expect('one\ntwo\n  three').toMatchSnapshot();
    expect('back`tick ${dollar} \\ slash "quote" \'single\'').toMatchSnapshot();
    expect('crlf\r\nline').toMatchSnapshot();
    expect('').toMatchSnapshot();
    expect('  padded  ').toMatchSnapshot();
});

it('objects', () => {
    expect({
        a: 1,
        b: [1, 2, { c: 'd' }],
        e: new Map([['k', new Set([1])]])
    }).toMatchSnapshot();
    expect(new Point(1, 2)).toMatchSnapshot();
    expect([]).toMatchSnapshot();
    expect({}).toMatchSnapshot();
    expect(new Date(0)).toMatchSnapshot();
    expect(/re+/gi).toMatchSnapshot();
    expect(Symbol('s')).toMatchSnapshot();
    expect(function named() {}).toMatchSnapshot();
    expect(new Uint8Array([1, 2])).toMatchSnapshot();
    expect(Object.create(null)).toMatchSnapshot();
});

it('errors', () => {
    expect(new Error('plain')).toMatchSnapshot();
    expect(
        new TypeError('typed', { cause: new Error('cause') })
    ).toMatchSnapshot();
    expect(() => {
        throw new Error('thrown\nover lines');
    }).toThrowErrorMatchingSnapshot();
    expect(() => {
        throw new RangeError('with hint');
    }).toThrowErrorMatchingSnapshot('the hint');
});

it('rejects', async () => {
    await expect(
        Promise.reject(new Error('rejected'))
    ).rejects.toThrowErrorMatchingSnapshot();
    await expect(Promise.resolve({ ok: true })).resolves.toMatchSnapshot();
});

it('hints and counters', () => {
    expect('first').toMatchSnapshot();
    expect('hinted').toMatchSnapshot('a hint');
    expect('second').toMatchSnapshot();
    expect('hinted again').toMatchSnapshot('a hint');
    expect('other').toMatchSnapshot('b hint');
});

it('property matchers', () => {
    expect({
        id: Math.random(),
        at: new Date(),
        name: 'n',
        nested: { v: Math.random(), w: 1 }
    }).toMatchSnapshot({
        id: expect.any(Number),
        at: expect.any(Date),
        nested: { v: expect.any(Number) }
    });
    expect({ id: 3, name: 'm' }).toMatchSnapshot(
        { id: expect.any(Number) },
        'with hint'
    );
});

it('mock functions', () => {
    const fn = vi.fn<(count: number, name: string) => void>();
    fn(1, 'a');
    expect(fn).toMatchSnapshot();
    expect(vi.fn<() => void>().mockName('named')).toMatchSnapshot();
});

it('asymmetric', () => {
    expect({
        a: expect.any(String),
        b: expect.stringContaining('x')
    }).toMatchSnapshot();
});

describe('outer', () => {
    it('in suite', () => {
        expect('outer').toMatchSnapshot();
    });

    describe('inner > with arrow', () => {
        it('deep', () => {
            expect('deep').toMatchSnapshot();
        });

        it.each([
            [1, 'one'],
            [2, 'two']
        ])('each %i is %s', (n, s) => {
            expect({ n, s }).toMatchSnapshot();
        });

        it.each([{ name: 'x' }, { name: 'y' }])('object $name', row => {
            expect(row).toMatchSnapshot();
        });

        test.for([1, 2])('for %d', n => {
            expect(n * 2).toMatchSnapshot();
        });
    });

    describe.each(['a', 'b'])('suite %s', letter => {
        it('row', () => {
            expect(letter).toMatchSnapshot();
        });
    });
});

it('same name', () => {
    expect('same 1').toMatchSnapshot();
});

it('same name', () => {
    expect('same 2').toMatchSnapshot();
});

it('name with `backtick` and ${dollar} and 10 2', () => {
    expect('odd').toMatchSnapshot();
});

it('serializer', () => {
    expect.addSnapshotSerializer({
        test: value => value instanceof Point,
        serialize: (value: Point) => `Point(${value.x}, ${value.y})`
    });
    expect(new Point(3, 4)).toMatchSnapshot();
    expect({ p: new Point(5, 6) }).toMatchSnapshot();
});

it.skip('skipped', () => {
    expect('skipped').toMatchSnapshot();
});
