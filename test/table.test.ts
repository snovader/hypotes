import { describe, expect, it } from 'hypotes';
import { fc, it as property } from 'hypotes/fast-check';
import { parseTable } from '#source/table';

/** The rows of a table in a template literal */
function table(
    strings: TemplateStringsArray,
    ...values: unknown[]
): Array<Record<string, unknown>> {
    return parseTable(strings, values);
}

/** A template's strings, of the columns' names and then a row on each line */
function stringsOf(names: readonly string[], count: number): string[] {
    const strings = [`\n    ${names.join(' | ')}\n    `];
    for (let index = 1; index <= count; index++) {
        strings.push(index % names.length === 0 ? '\n    ' : ' | ');
    }

    return strings;
}

const NAME = fc.stringMatching(/^[a-z][a-z\d]*$/);

describe('parseTable', () => {
    property.prop([
        fc.uniqueArray(NAME, { minLength: 1, maxLength: 4 }),
        fc.array(fc.anything(), { maxLength: 12 })
    ])('should fill a row of the columns at a time with the values, in order', (names, values) => {
        const rows = parseTable(stringsOf(names, values.length), values);

        expect(rows).toHaveLength(Math.floor(values.length / names.length));
        for (const [index, row] of rows.entries()) {
            expect(Object.keys(row)).toEqual(names);
            for (const [column, name] of names.entries()) {
                expect(row[name]).toBe(values[index * names.length + column]);
            }
        }
    });

    // Each is the result of Vitest 5.1's runner, quirks and all
    it('should leave out a last row that the values do not fill', () => {
        const rows = table`
            a    | b
            ${1} | ${-0}
            ${3}
        `;

        expect(rows).toHaveLength(1);
        expect(Object.is(rows[0]?.b, -0)).toBe(true);
    });

    it('should name the columns by the first line alone, without its spaces', () => {
        expect(table`a	|	b c
            ${1} | ${2}
        `).toEqual([{ 'a\t': 1, '\tbc': 2 }]);
    });

    it('should name a column for a bar at either end, which the later replaces', () => {
        expect(table`
            | a    | b    |
            | ${1} | ${2} | ${3} | ${4}
        `).toEqual([{ '': 4, a: 2, b: 3 }]);
    });

    it('should take a value on the first line as a value', () => {
        expect(table`
            a | b ${'x'}
            ${1} | ${2}
        `).toEqual([{ a: 'x', b: 1 }]);
    });
});
