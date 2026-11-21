// A test and a hook that take longer than the timeout that `cli.test.ts`
// passes, and less than the command's default
import { before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

it('is slow', () => sleep(300));

describe('with a slow hook', () => {
    before(() => sleep(300));

    it('follows it', () => {});
});
