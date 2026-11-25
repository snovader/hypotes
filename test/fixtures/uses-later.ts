// A module that imports `later.ts`, which the tests of `vi.doMock()` mock in
// part, before they mock `later.ts`
import { value } from './later.ts';

export function describeLater(): string {
    return `later: ${value()}`;
}
