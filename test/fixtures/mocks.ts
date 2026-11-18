#!/usr/bin/env node
// Tests that `declarations.test.ts` runs with hypotes/register, which moves
// the code of a module that mocks modules, below its hashbang, and whose
// source map maps the sites of its tests back. Its tests fail where they
// should.
import { expect, it, vi } from 'hypotes';
import { value } from './later.ts';

vi.mock('./later.ts', () => ({ value: () => 'mocked' }));

it('mocks are hoisted above the imports', () => {
    expect(value()).toBe('mocked');
});

it('a failure in a module that mocks points at its line', () => {
    expect(value()).toBe('original');
});
