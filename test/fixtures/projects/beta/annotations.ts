import assert from 'node:assert/strict';
import { it } from 'node:test';

it('throws a multiline error', () => {
    throw new Error(
        'Invalid input\n    at least two values are required\n    at /example.ts:1:2'
    );
});

it('prints a coloured diff', () => {
    assert.deepStrictEqual({ value: 1 }, { value: 2 });
});
