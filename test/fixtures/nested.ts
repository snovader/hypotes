// A module that `declarations.test.ts` runs with hypotes/register, which
// rejects a call of vi.mock() outside of its top level
import { expect, it, vi } from 'hypotes';

it('vi.mock in a test', () => {
    vi.mock('./later.ts', () => ({ value: () => 'nested' }));
    expect(true).toBe(true);
});
