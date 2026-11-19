// The rows of a table in a template literal, which `.each` and `.for` take,
// as Vitest 5.1's runner reads them, in its `formatTemplateString`:
//
//     it.each`
//         a    | b    | sum
//         ${1} | ${2} | ${3}
//     `('$a + $b is $sum', ({ a, b, sum }) => { ... });
//
// The first line of the template's text, once its ends are trimmed, names the
// columns, between bars, with its spaces removed: a bar at either end names a
// column '', and a tab stays in a name. The values fill a row of the columns
// at a time, in order, whatever lines they're on, and a last row that they
// don't fill is left out.

/**
 * The rows of a table, each an object of its columns' values, from a
 * template's strings and values
 */
export function parseTable(
    strings: readonly string[],
    values: readonly unknown[]
): Array<Record<string, unknown>> {
    const columns = headerOf(strings).split('|');
    const count = Math.floor(values.length / columns.length);

    const rows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < count; index++) {
        rows.push(rowAt(columns, values, index));
    }

    return rows;
}

/** The first line of the template's text, without spaces */
function headerOf(strings: readonly string[]): string {
    const text = strings.join('').trim();
    const end = text.indexOf('\n');
    const line = end === -1 ? text : text.slice(0, end);

    return line.replaceAll(' ', '');
}

/**
 * The row of the index, which assigns each value to its column's name, as
 * Vitest does: a later column of the same name replaces an earlier one
 */
function rowAt(
    columns: readonly string[],
    values: readonly unknown[],
    index: number
): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const [column, name] of columns.entries()) {
        row[name] = values[index * columns.length + column];
    }

    return row;
}
