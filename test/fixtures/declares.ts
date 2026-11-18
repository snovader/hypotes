// A module whose statements would take more than vi.hoisted() above the
// module's code, which hypotes/register rejects
import { sep } from 'node:path';
import { vi } from 'hypotes';

const first = vi.hoisted(() => 1),
    separator = sep;
export const exported = vi.hoisted(() => 2);

export const values = [first, separator];
