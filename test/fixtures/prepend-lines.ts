// A load hook that `declarations.test.ts` preloads before hypotes/register,
// so that it runs after it, through its `nextLoad`, as a hook that strips
// TypeScript would. It prepends two lines to `prepended.ts`, which export
// what that reads, and ends it with an inline source map that maps them out.
// Preloaded as `prepend-lines.ts?map=<form>`, it writes the map in another
// form:
//
// - `invalid`: a map that isn't JSON
// - `charset`: with `charset=utf-8`, and followed by CRLF and whitespace
// - `code-after`: followed by a line of code, which declares a test, and
//   ends in a character of base64
// - `sections`: an index map of two sections, from the module's 11th line
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';

const PREPENDED = new URL('prepended.ts', import.meta.url).href;
const LINES = 'export const prepended = true;\n\n';
const FORM = new URL(import.meta.url).searchParams.get('map');

/** The module's line, from 0, at which the second section starts */
const SECOND_SECTION = 10;

const decoder = new TextDecoder();

/**
 * The mappings of lines that each map to the next line of the source, from
 * the line before the first, whose first segment the start gives
 */
function lineMappings(start: string, lines: number): string {
    return `${start}${';AACA'.repeat(lines - 1)}`;
}

/** The map of the code after the prepended lines */
function mapOf(url: string, lines: number): unknown {
    if (FORM !== 'sections') {
        // The prepended lines map to nothing, and each line after them to
        // the one that it was
        const mappings = `;;${lineMappings('AAAA', lines)}`;
        return { version: 3, sources: [url], names: [], mappings };
    }

    // The first section names another source first, so that the second's
    // source maps to the module only if its index follows the first's
    // sources. `AAUA` maps to line 10 of its source.
    const first = {
        version: 3,
        sources: ['file:///elsewhere.ts', url],
        names: [],
        mappings: lineMappings('ACAA', SECOND_SECTION)
    };
    const second = {
        version: 3,
        sources: [url],
        names: [],
        mappings: lineMappings('AAUA', lines - SECOND_SECTION)
    };

    return {
        version: 3,
        sections: [
            { offset: { line: 2, column: 0 }, map: first },
            { offset: { line: 2 + SECOND_SECTION, column: 0 }, map: second }
        ]
    };
}

/** The comment of the inline map, and what follows it */
function commentOf(url: string, lines: number): string {
    const json = FORM === 'invalid' ? '{' : JSON.stringify(mapOf(url, lines));
    const base64 = Buffer.from(json).toString('base64');

    switch (FORM) {
        case 'charset':
            return `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}\r\n \t\n`;
        case 'code-after':
            return `//# sourceMappingURL=data:application/json;base64,${base64}\nit('code after the map runs', () => {}); // ends in base64\n`;
        default:
            return `//# sourceMappingURL=data:application/json;base64,${base64}\n`;
    }
}

registerHooks({
    load(url, context, nextLoad) {
        const loaded = nextLoad(url, context);
        const { source } = loaded;
        if (url !== PREPENDED || source === undefined) {
            return loaded;
        }

        const code =
            typeof source === 'string' ? source : decoder.decode(source);
        const lines = code.split('\n').length;
        return {
            ...loaded,
            source: `${LINES}${code}\n${commentOf(url, lines)}`
        };
    }
});
