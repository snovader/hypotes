// A module that imports `later.ts` without waiting for the factories of
// mocks, since it doesn't mock modules itself
import type * as Later from './later.ts';

export function load(): Promise<typeof Later> {
    return import('./later.ts');
}
