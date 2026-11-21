// Declares a test for the file that calls it, from another package, for
// `reporter.test.ts`
import { it } from 'node:test';

export function declare(name: string): void {
    it(name, () => {});
}
