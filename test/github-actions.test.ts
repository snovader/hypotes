import { stripVTControlCharacters } from 'node:util';
import { describe, expect } from 'hypotes';
import { fc, it } from 'hypotes/fast-check';
import { formatErrorCommand, formatJobSummary, type Annotation } from '#source/github-actions';

/** A value of a command, as GitHub's runner unescapes it */
function unescape(text: string): string {
    return text
        .replaceAll('%0D', '\r')
        .replaceAll('%0A', '\n')
        .replaceAll('%3A', ':')
        .replaceAll('%2C', ',')
        .replaceAll('%25', '%');
}

/**
 * A command's name, properties and message, as GitHub's runner reads them:
 * the properties end at the first `::`, each at a comma, and its name at
 * the first `=`
 */
function parseCommand(command: string): {
    name: string;
    properties: Record<string, string>;
    message: string;
} {
    const end = command.indexOf('::', 2);
    const space = command.indexOf(' ');
    const name = command.slice(2, space);
    const properties = command.slice(space + 1, end);

    return {
        name,
        properties: Object.fromEntries(
            properties.split(',').map(property => {
                const equals = property.indexOf('=');
                return [property.slice(0, equals), unescape(property.slice(equals + 1))];
            })
        ),
        message: unescape(command.slice(end + 2))
    };
}

const annotation: fc.Arbitrary<Annotation> = fc.record({
    file: fc.string(),
    line: fc.nat(),
    column: fc.nat(),
    title: fc.string(),
    message: fc.string()
});

/** Strings of the characters that a command escapes, and of what it escapes them to */
const special = fc
    .array(fc.constantFrom('%', '\r', '\n', ':', ',', '::', '=', ' ', '%25', '%0A', '%3A', 'a'))
    .map(parts => parts.join(''));

describe('formatErrorCommand', () => {
    it("should format an error's command with its properties in Vitest's order", () => {
        const command = formatErrorCommand({
            file: '/work/a,b/100%.test.ts',
            line: 9,
            column: 20,
            title: '[@scope/name] test/a.test.ts > suite > adds 1, 2: 3',
            message: 'Error: 50% of a,b: c\r\n ❯ test/a.test.ts:9:20'
        });

        expect(command).toBe(
            '::error file=/work/a%2Cb/100%25.test.ts,' +
                'title=[@scope/name] test/a.test.ts > suite > adds 1%2C 2%3A 3,' +
                'line=9,col=20::Error: 50%25 of a,b: c%0D%0A ❯ test/a.test.ts:9:20'
        );
    });

    it("should escape a Windows path's colon, and leave its separators", () => {
        const command = formatErrorCommand({
            file: 'C:\\work\\a.test.ts',
            line: 1,
            column: 1,
            title: 'a.test.ts',
            message: 'failed'
        });

        expect(command).toBe(
            '::error file=C%3A\\work\\a.test.ts,title=a.test.ts,line=1,col=1::failed'
        );
    });

    it.prop([annotation])('should fit on one line', given => {
        expect(formatErrorCommand(given)).not.toMatch(/[\r\n]/);
    });

    it.prop([
        fc.record({
            file: special,
            line: fc.nat(),
            column: fc.nat(),
            title: special,
            message: special
        })
    ])("should be read back as it's given, whatever it escapes", given => {
        expect(parseCommand(formatErrorCommand(given))).toStrictEqual({
            name: 'error',
            properties: {
                file: given.file,
                title: given.title,
                line: String(given.line),
                col: String(given.column)
            },
            message: given.message
        });
    });

    it.prop([annotation])('should round-trip the location, title and plain-text message', given => {
        const { properties, message } = parseCommand(formatErrorCommand(given));

        expect(properties.file).toBe(given.file);
        expect(properties.title).toBe(given.title);
        expect(message).toBe(stripVTControlCharacters(given.message));
    });
});

describe('formatJobSummary', () => {
    it("should format the results as Vitest's summary does", () => {
        const files = { failed: 1, passed: 2, skipped: 0, todo: 0 };
        const tests = { failed: 1, passed: 5, skipped: 1, todo: 2 };

        expect(formatJobSummary(files, tests)).toBe(
            [
                '## hypotes Test Report',
                '',
                '### Summary',
                '',
                '- **Test Files**: ❌ **1 failure** · ✅ **2 passes** · 3 total',
                '- **Test Results**: ❌ **1 failure** · ✅ **5 passes** · 6 total',
                '- **Other**: 1 skip · 2 todos · 3 total',
                ''
            ].join('\n')
        );
    });

    it('should leave out the results that no test had', () => {
        const files = { failed: 0, passed: 1, skipped: 0, todo: 0 };
        const tests = { failed: 0, passed: 1, skipped: 0, todo: 0 };

        expect(formatJobSummary(files, tests)).toBe(
            [
                '## hypotes Test Report',
                '',
                '### Summary',
                '',
                '- **Test Files**: ✅ **1 pass** · 1 total',
                '- **Test Results**: ✅ **1 pass** · 1 total',
                ''
            ].join('\n')
        );
    });

    it('should count nothing for a run without tests', () => {
        const none = { failed: 0, passed: 0, skipped: 0, todo: 0 };

        expect(formatJobSummary(none, none)).toContain('- **Test Files**: 0 total\n');
    });
});
