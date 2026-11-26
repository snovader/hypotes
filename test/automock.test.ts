import { describe, expect, it, vi } from 'hypotes';
import { fc, it as property } from 'hypotes/fast-check';

/**
 * Values of JSON's shapes, and undefined, doubles such as -0 and NaN, and
 * bigints. Their keys leave out `__proto__`, which the automocker assigns,
 * as Vitest's does, so that it sets the prototype.
 */
const data = fc.anything({
    key: fc.string().filter(key => key !== '__proto__'),
    values: [
        fc.double(),
        fc.constant(-0),
        fc.bigInt(),
        fc.string(),
        fc.boolean(),
        fc.constant(null),
        fc.constant(undefined)
    ]
});

/** What automocking makes of data: arrays empty, and objects copied */
function automocked(value: unknown): unknown {
    if (Array.isArray(value)) {
        return [];
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }

    const copy: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(value)) {
        copy[key] = automocked(property);
    }
    return copy;
}

interface Counter {
    value: number;
    increment: () => number;
    readonly doubled: number;
}

/** An object of each kind of value that automocking mocks */
interface Shapes {
    add: (a: number, b: number) => number;
    nested: { deep: { read: () => string }; count: number };
    list: number[];
    label: string;
    Counter: { new (): Counter; create: () => Counter };
    circular: { self?: unknown; read: () => string };
    readonly computed: string;
}

/**
 * Shapes, with a class of their own, whose methods a spy replaces in place
 */
function makeShapes(): Shapes {
    class Counter {
        static create(): Counter {
            return new Counter();
        }

        value = 1;

        increment(): number {
            return ++this.value;
        }

        get doubled(): number {
            return this.value * 2;
        }
    }

    const circular: { self?: unknown; read: () => string } = { read: () => 'read' };
    circular.self = circular;

    return {
        add: (a: number, b: number): number => a + b,
        nested: { deep: { read: (): string => 'deep' }, count: 1 },
        list: [1, 2],
        label: 'label',
        Counter,
        circular,
        get computed(): string {
            return 'computed';
        }
    };
}

describe('vi.mockObject', () => {
    property.prop([data])(
        'should keep primitives, empty arrays, and copy objects deeply',
        value => {
            const before = structuredClone(value);
            const mocked = vi.mockObject(value);

            expect(mocked).toEqual(automocked(value));
            expect(value).toEqual(before);
        }
    );

    it('should mock functions to return undefined, deeply, and leave the original', () => {
        const shapes = makeShapes();
        const mocked = vi.mockObject(shapes);

        expect([mocked.add(1, 2), mocked.nested.deep.read(), mocked.computed]).toEqual([
            undefined,
            undefined,
            undefined
        ]);
        expect(mocked.add).toHaveBeenCalledWith(1, 2);
        expect([mocked.list, mocked.label, mocked.nested.count]).toEqual([[], 'label', 1]);
        expect([shapes.add(1, 2), shapes.list]).toEqual([3, [1, 2]]);
    });

    it('should mock a class, whose instances have mocked methods', () => {
        const { Counter } = vi.mockObject(makeShapes());
        const counter = new Counter();

        expect(counter).toBeInstanceOf(Counter);
        expect([counter.value, counter.increment(), counter.doubled]).toEqual([
            undefined,
            undefined,
            undefined
        ]);
        expect(Counter.create()).toBeUndefined();
        expect(vi.mocked(Counter).mock.instances).toEqual([counter]);
    });

    it('should keep the implementations with spy, and record their calls', () => {
        const mocked = vi.mockObject(makeShapes(), { spy: true });
        const counter = new mocked.Counter();

        expect([mocked.add(1, 2), mocked.nested.deep.read(), mocked.computed]).toEqual([
            3,
            'deep',
            'computed'
        ]);
        expect([counter.increment(), counter.doubled, mocked.list]).toEqual([2, 4, [1, 2]]);
        expect(mocked.add).toHaveBeenCalledWith(1, 2);
        expect(counter.increment).toHaveBeenCalledTimes(1);
    });

    it("should spy on the object's functions in place with spy, as Vitest does", () => {
        const shapes = makeShapes();
        const { add } = shapes;
        const mocked = vi.mockObject(shapes, { spy: true });

        expect(mocked).toBe(shapes);
        expect(mocked.nested).toBe(shapes.nested);
        expect(shapes.add).not.toBe(add);
        expect(vi.isMockFunction(shapes.nested.deep.read)).toBe(true);
    });

    it('should keep references to the same object, as in a cycle', () => {
        const mocked = vi.mockObject(makeShapes());

        expect(mocked.circular.self).toBe(mocked.circular);
        expect(vi.isMockFunction(mocked.circular.read)).toBe(true);
    });

    it('should mock a function itself', () => {
        const mocked = vi.mockObject((value: number) => value * 2);
        const spied = vi.mockObject((value: number) => value * 2, { spy: true });
        mocked.mockReturnValue(3);

        expect([mocked(1), spied(1)]).toEqual([3, 2]);
        expect(spied).toHaveBeenCalledWith(1);
    });
});
