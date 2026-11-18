// A module that exports the exports of a module that it mocks, which
// hypotes/register loads after the mock, as it does its imports
import { vi } from 'hypotes';

export { default as renamed, name, one as 'a string' } from './reexported.ts';
export * as all from './reexported.ts';
export type * from './reexported.ts';

vi.mock('./reexported.ts', () => ({
    default: 'mocked',
    name: () => 'mocked',
    one: 2
}));
