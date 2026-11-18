// A module whose only calls of `vi` take type arguments, which
// hypotes/register finds as it does those without: it hoists the first above
// the import of `reads.ts`, and resolves the path of the second from here.
// No comment here writes such a call without them, which it would find too.
import { vi } from 'hypotes';
import { read } from './reads.ts';
import type * as Values from './values.ts';

vi.hoisted<void>(() => {
    (globalThis as { hoistedFirst?: boolean }).hoistedFirst = true;
});

/** Whether the hoisted call ran before `reads.ts` loaded */
export const hoistedFirst: boolean = read;

/** The original of `values.ts`, whatever mocks it */
export function actual(): Promise<typeof Values> {
    return vi.importActual<typeof Values>('./values.ts');
}
