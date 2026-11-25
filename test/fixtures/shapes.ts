// A module of each kind of export, which the tests of automocking mock
export { greeting as reexported } from './greeting.ts';

export const count = 1;
export const label = 'label';
export const nothing = null;
export const list = [1, 2];
export const settings = {
    depth: { value: 1, read: (): number => 1 },
    items: [1]
};

export function add(a: number, b: number): number {
    return a + b;
}

export class Counter {
    static readonly start = 1;

    static create(): Counter {
        return new Counter();
    }

    value = Counter.start;

    increment(): number {
        return ++this.value;
    }

    get doubled(): number {
        return this.value * 2;
    }
}

// oxlint-disable-next-line import/no-default-export -- Which automocking mocks too
export default function greet(name: string): string {
    return `hello ${name}`;
}
