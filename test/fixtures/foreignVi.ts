// A module whose vi comes from another module than hypotes, which
// hypotes/register rejects: its mocks would be hoisted above the import of vi
import { value } from './later.ts';
import { vi } from './vi.ts';

vi.mock('./later.ts', () => ({ value: () => 'mocked' }));

export const imported = value();
