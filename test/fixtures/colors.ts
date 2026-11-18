// A test that `declarations.test.ts` runs with and without colours, whose
// failure prints the calls of a spy, which @vitest/expect colours
import { expect, it, vi } from 'hypotes';

it("a spy's matcher fails", () => {
    const spy = vi.fn<(value: number) => number>(value => value * 2);
    spy(2);

    expect(spy).toHaveReturnedWith(5);
});
