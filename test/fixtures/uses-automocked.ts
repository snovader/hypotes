// A module that imports `automocked.ts`, which `mocks.test.ts` mocks in part,
// before it mocks `automocked.ts`
import { fetchValue } from './automocked.ts';

export function describeValue(): string {
    return `value: ${fetchValue()}`;
}

export function replaced(): string {
    return 'original';
}
