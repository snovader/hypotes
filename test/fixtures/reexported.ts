// A module that `reexports.ts` mocks, and exports the exports of
export const one = 1;

export function name(): string {
    return 'original';
}

// oxlint-disable-next-line import/no-default-export -- Which `reexports.ts` exports by another name
export default 'original';
