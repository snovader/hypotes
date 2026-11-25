// A module that `mocks.test.ts` mocks without a factory, and
// `uses-automocked.ts` imports
export function fetchValue(): string {
    return 'original';
}

export const values = [1, 2];
