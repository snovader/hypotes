// A test that `declarations.test.ts` runs with hypotes/register, in a module
// whose lines end in CRLF, which .gitattributes keeps and oxfmt leaves
import { expect, it, vi } from 'hypotes';
import { value } from './later.ts';

vi.mock('./later.ts', () => ({ value: () => 'mocked' }));

it('mocks in a module whose lines end in CRLF', () => {
    expect(value()).toBe('mocked');
});
