// A module that reads, as it loads, what `typed.ts` sets in its hoisted call
export const read: boolean =
    (globalThis as { hoistedFirst?: boolean }).hoistedFirst === true;
