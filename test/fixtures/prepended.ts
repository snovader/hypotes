// Tests that `declarations.test.ts` runs with hypotes/register, after a load
// hook, `prepend-lines.ts`, that runs after hypotes/register, prepends two
// lines, and maps them out with an inline source map, which hypotes/register
// chains. Its tests fail where they should.
import { expect, it, vi } from 'hypotes';
import { value } from './later.ts';

/** What the hook's lines export */
declare const prepended: boolean;

vi.mock('./later.ts', () => ({ value: () => 'mocked' }));

it('mocks are hoisted after a hook that maps its code', () => {
    expect(prepended).toBe(true);
    expect(value()).toBe('mocked');
});

it('a failure in a module that a hook maps points at its line', () => {
    expect(value()).toBe('original');
});
