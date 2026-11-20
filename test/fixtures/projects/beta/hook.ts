// A file whose suite fails in a hook, for `reporter.test.ts`
import { after, describe, it } from 'node:test';

describe('suite', () => {
    after(() => {
        throw new Error('the hook failed');
    });

    it('passes', () => {});
});
