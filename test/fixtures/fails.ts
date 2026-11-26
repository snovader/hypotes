// A module that fails as it runs, which the tests of automocking mock
export const value = 1;

throw new Error('fails.ts failed to load');
