import { expect, it, vi } from 'hypotes';
import { greet } from './dep.ts';

interface Options {
    readonly loud: boolean;
}

vi.mock('./dep.ts', () => ({
    greet: (name: string): string => `mocked ${name}`
}));

const hoisted = vi.hoisted(() => ({ value: 1 }));

it('mocked inline', () => {
    const options: Options = { loud: true };
    expect(greet('a')).toMatchInlineSnapshot();
    expect({ options, hoisted }).toMatchInlineSnapshot();
});

it('mocked external', async () => {
    const dep = await import('./dep.ts');
    expect(dep.greet('b')).toMatchSnapshot();
    expect(() => {
        throw new Error(greet('c'));
    }).toThrowErrorMatchingInlineSnapshot();
});
