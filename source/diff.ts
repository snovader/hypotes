// The lines that differ between two values, as the message of a failed
// matcher carries them: node:test's reporters print an error's message, but
// not the diff that Vitest's reporter prints.
import { diff, inspect, type InspectOptions } from 'node:util';

/** Unchanged lines kept around each change */
const CONTEXT = 3;

/**
 * The lines of each value that are compared, from the first that differs:
 * comparing takes time that grows with their number times the number that
 * differ, which is seconds for tens of thousands of lines
 */
const MAX_LINES = 1000;

const OMITTED = '  ...';

const INSPECT_OPTIONS: InspectOptions = {
    depth: Infinity,
    maxArrayLength: Infinity,
    maxStringLength: Infinity,
    sorted: true
};

/**
 * The lines of two values' inspections that differ, with some around them,
 * or undefined if none does
 */
export function diffValues(
    actual: unknown,
    expected: unknown
): string | undefined {
    return diffLines(
        inspect(actual, INSPECT_OPTIONS).split('\n'),
        inspect(expected, INSPECT_OPTIONS).split('\n')
    );
}

/**
 * The lines that differ between an actual value's and an expected one's,
 * each marked as one's or the other's, with some around them, or undefined
 * if none does
 */
export function diffLines(
    actualLines: readonly string[],
    expectedLines: readonly string[]
): string | undefined {
    // The lines that both start and end with are the same in both
    const start = commonStart(actualLines, expectedLines);
    const end = commonEnd(actualLines, expectedLines, start);
    if (start + end === Math.max(actualLines.length, expectedLines.length)) {
        return undefined;
    }

    const from = Math.max(0, start - CONTEXT);
    const actualTo = Math.min(
        actualLines.length - end + CONTEXT,
        from + MAX_LINES
    );
    const expectedTo = Math.min(
        expectedLines.length - end + CONTEXT,
        from + MAX_LINES
    );
    const changes = diff(
        actualLines.slice(from, actualTo),
        expectedLines.slice(from, expectedTo)
    );
    const hasAfter =
        actualTo < actualLines.length || expectedTo < expectedLines.length;

    return describeChanges(changes, from > 0, hasAfter);
}

/** How many lines both start with */
function commonStart(a: readonly string[], b: readonly string[]): number {
    const length = Math.min(a.length, b.length);
    let count = 0;
    while (count < length && a[count] === b[count]) {
        count++;
    }

    return count;
}

/** How many lines both end with, after the `start` that both start with */
function commonEnd(
    a: readonly string[],
    b: readonly string[],
    start: number
): number {
    const length = Math.min(a.length, b.length) - start;
    let count = 0;
    while (
        count < length &&
        a[a.length - 1 - count] === b[b.length - 1 - count]
    ) {
        count++;
    }

    return count;
}

/**
 * The changed lines, each marked as the actual value's or the expected
 * one's, with the unchanged lines around them, and a mark where others are
 * left out: between them, and before and after, if there are any
 */
function describeChanges(
    changes: ReturnType<typeof diff>,
    hasBefore: boolean,
    hasAfter: boolean
): string {
    const changed = changes.map(([operation]) => operation !== 0);
    const nearChange = (index: number): boolean =>
        changed
            .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
            .includes(true);

    const lines: string[] = hasBefore ? [OMITTED] : [];
    for (const [index, [operation, line]] of changes.entries()) {
        if (nearChange(index)) {
            lines.push(
                `${operation === 1 ? '+' : operation === -1 ? '-' : ' '} ${line}`
            );
        } else if (lines.at(-1) !== OMITTED) {
            lines.push(OMITTED);
        }
    }
    if (hasAfter && lines.at(-1) !== OMITTED) {
        lines.push(OMITTED);
    }

    return lines.join('\n');
}
