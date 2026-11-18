// Tests that `declarations.test.ts` runs with `only`
import { expect, it } from 'hypotes';

it.only('only runs', () => {
    expect(true).toBe(true);
});

it('the others are skipped', () => {
    expect('ran').toBe('skipped');
});
