// A test that leaves a timer running, which keeps the file's process
// alive after its tests unless node:test ends it, for `cli.test.ts`
import process from 'node:process';
import { it } from 'node:test';

it('leaves a timer', () => {
    setTimeout(() => {
        process.stderr.write('the timer ran\n');
    }, 1000);
});
