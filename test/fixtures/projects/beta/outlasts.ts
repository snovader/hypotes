// A test that outlasts the command's default timeout, Vitest's 5 seconds,
// for `cli.test.ts`
import { it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

it('outlasts the timeout', () => sleep(5200));
