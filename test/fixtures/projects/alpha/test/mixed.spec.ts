// A file with a test of each result, one of which fails on purpose, for
// `reporter.test.ts`
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** Types, which Node strips, and leaves each position below where it was */
interface Operands {
    readonly actual: number;
    readonly expected: number;
}

describe('outer', () => {
    describe('inner', () => {
        it('fails', () => {
            const { actual, expected }: Operands = { actual: 1, expected: 2 };

            assert.equal(actual, expected, 'one is not two');
        });
    });

    it('passes', () => {});

    it.skip('is skipped', () => {});

    it.todo('is to do');

    it('is to do, and fails', { todo: true }, () => {
        throw new Error('not yet');
    });
});
