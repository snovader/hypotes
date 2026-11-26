import { describe, expect, it } from 'hypotes';

const order: string[] = [];
const middleStarted = Promise.withResolvers<void>();
const fastEnded = Promise.withResolvers<void>();
const middleEnded = Promise.withResolvers<void>();

// The tests wait for each other, so they end only if they run at once. Each
// takes the package's `expect`, where Vitest's tests that run at once need
// their context's.
describe('at once', { concurrency: true }, () => {
    it('slow', async () => {
        order.push('slow starts');
        expect('slow before').toMatchSnapshot();
        await middleEnded.promise;
        expect('slow after').toMatchSnapshot();
        expect('slow inline').toMatchInlineSnapshot();
        await expect('slow file\n').toMatchFileSnapshot('./golden/concurrent-slow.txt');
    });

    it('fast', async () => {
        order.push('fast starts');
        expect('fast before').toMatchSnapshot();
        await middleStarted.promise;
        order.push('fast ends');
        expect('fast after').toMatchSnapshot();
        expect('fast inline').toMatchInlineSnapshot();
        await expect('fast file\n').toMatchFileSnapshot('./golden/concurrent-fast.txt');
        fastEnded.resolve();
    });

    it('middle', async () => {
        order.push('middle starts');
        expect('middle before').toMatchSnapshot('hint');
        middleStarted.resolve();
        await fastEnded.promise;
        order.push('middle ends');
        expect('middle after').toMatchSnapshot('hint');
        expect({ order }).toMatchInlineSnapshot();
        middleEnded.resolve();
    });
});
