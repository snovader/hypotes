// A load hook that `declarations.test.ts` preloads before hypotes/register,
// so that it runs after it, through its `nextLoad`, as a hook that strips
// TypeScript would. It prepends two lines to `prepended.ts`, which export
// what that reads, and ends it with an inline source map that maps them out.
// Preloaded as `prepend-lines.ts?map=invalid`, it ends it with a map that
// isn't JSON instead.
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';

const PREPENDED = new URL('prepended.ts', import.meta.url).href;
const LINES = 'export const prepended = true;\n\n';
const INVALID = new URL(import.meta.url).searchParams.get('map') === 'invalid';

const decoder = new TextDecoder();

/** The map of the code after the prepended lines, as base64 */
function mapOf(url: string, code: string): string {
    // The prepended lines map to nothing, and each line after them to the
    // one that it was
    const lines = code.split('\n').length;
    const mappings = `;;AAAA${';AACA'.repeat(lines - 1)}`;
    const map = { version: 3, sources: [url], names: [], mappings };

    return Buffer.from(INVALID ? '{' : JSON.stringify(map)).toString('base64');
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
        const map = mapOf(url, code);
        return {
            ...loaded,
            source: `${LINES}${code}\n//# sourceMappingURL=data:application/json;base64,${map}\n`
        };
    }
});
