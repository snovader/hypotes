// A file with a test of each result, one of which fails on purpose, for
// `reporter.test.ts`
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('outer', () => {
    describe('inner', () => {
        it('fails', () => {
            assert.equal(1, 2, 'one is not two');
        });
    });

    it('passes', () => {});

    it.skip('is skipped', () => {});

    it.todo('is to do');

    it('is to do, and fails', { todo: true }, () => {
        throw new Error('not yet');
    });
});
