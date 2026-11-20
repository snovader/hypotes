// A reporter that prints whether node:test says which test file a test is
// from, for `reporter.test.ts`
import type { TestEvent } from 'node:test/reporters';

export default async function* entryFile(
    source: AsyncIterable<TestEvent>
): AsyncGenerator<string, void> {
    let named = false;

    for await (const { data } of source) {
        named ||= (data as { entryFile?: string }).entryFile !== undefined;
    }

    yield String(named);
}
