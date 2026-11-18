// A module that `mocks.test.ts` mocks, and `uses.ts` imports
export const one = 1;

export function double(value: number): number {
    return value * 2;
}

// oxlint-disable-next-line import/no-default-export -- Which the mock replaces
export default 'original';
