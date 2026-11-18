// A module that exports every export of another module, which
// hypotes/register rejects in a module that mocks: it would load before them
import { vi } from 'hypotes';

export * from './later.ts';

vi.mock('./later.ts', () => ({ value: () => 'mocked' }));
