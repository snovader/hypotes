// Vitest's hoisting of module mocks, for `hypotes/register`. In an ES module
// outside node_modules, the calls of `vi.mock()`, `vi.unmock()` and
// `vi.hoisted()` at its top level move above its code, and its imports, but
// those from hypotes, which define `vi`, become dynamic imports after them,
// so that the modules that it imports load with its mocks. So do its exports
// of other modules' exports, as `export { a } from` and `export * as`, which
// load those modules too. The paths of its mocks resolve from it, as
// `import.meta.resolve` resolves them there, or to a URL of their own for a
// package that isn't installed, as `mocks.ts` says. Its imports and dynamic
// imports wait for the factories of the mocks before them. A source map maps
// its stack traces, and the sites of its tests, to where they're written.
//
// Vitest's transform reads each imported binding from its module's
// namespace, where this one declares it as a constant: a binding that its
// module reassigns keeps the value that it had when it was imported, or
// exported from there. And where Vitest's exports every name of
// `export * from` as the module loads, this one rejects it: a module's
// exports are named before it runs, so that one would load before the mocks.
//
// A hook that runs after this one, through its `nextLoad`, such as one that
// strips TypeScript, can end the module with an inline source map of its
// own. Node reads only a module's last source map, so this one chains it: it
// maps the hoisted code to where that map does, and leaves out the comment
// that carried it. A map that doesn't parse is dropped, as Node would ignore
// it, and this one maps to the code as it's given.
//
// oxc-parser parses the module, and magic-string writes it and its source
// map: optional peer dependencies, which load once a module needs them.
import { Buffer } from 'node:buffer';
import {
    createRequire,
    getSourceMapsSupport,
    setSourceMapsSupport,
    SourceMap as NodeSourceMap,
    type LoadFnOutput,
    type SourceMapPayload,
    type SourceMapping
} from 'node:module';
import { fileURLToPath } from 'node:url';
import type * as MagicStringModule from 'magic-string';
import type * as Oxc from 'oxc-parser';
import { MOCKS_KEY } from './mocks.ts';

type MagicString = MagicStringModule.MagicString;
type DecodedSourceMap = MagicStringModule.DecodedSourceMap;
type SourceMapSegment = MagicStringModule.SourceMapSegment;

interface Span {
    readonly start: number;
    readonly end: number;
}

/** A call of a method of `vi` that mocks */
interface Call {
    readonly method: string;
    readonly node: Oxc.CallExpression;
}

/** A statement at the module's top level that calls `vi` to hoist */
interface Hoisted {
    readonly statement: Span;
    readonly call: Oxc.CallExpression;
}

/** `export { a } from`, rather than an export of the module's own */
type ExportFrom = Oxc.ExportNamedDeclaration & {
    readonly source: Oxc.StringLiteral;
};

/** A statement that loads another module, for its exports or to run it */
type Load = ExportFrom | Oxc.ExportAllDeclaration | Oxc.ImportDeclaration;

/** A module's code, and the inline source map that it ended with, if any */
interface MappedCode {
    readonly code: string;
    readonly map: NodeSourceMap | undefined;
}

/** The sources and names of a chained map, by their index in it */
class Indices {
    readonly #indices = new Map<string, number>();
    readonly values: string[] = [];

    /** The index of the value, which it adds if it's new */
    indexOf(value: string): number {
        let index = this.#indices.get(value);
        if (index === undefined) {
            index = this.values.length;
            this.#indices.set(value, index);
            this.values.push(value);
        }

        return index;
    }
}

interface Dependencies {
    readonly MagicString: typeof MagicStringModule.MagicString;
    readonly SourceMap: typeof MagicStringModule.SourceMap;
    readonly parseSync: typeof Oxc.parseSync;
    readonly Visitor: typeof Oxc.Visitor;
}

/**
 * A call that the transform looks for, before it parses the module, with
 * type arguments or without, as in `vi.importActual<typeof import('./a.ts')>()`
 */
const MOCK_CALL =
    /\bvi\s*\.\s*(?:mock|unmock|hoisted|doMock|doUnmock|importActual)\s*[(<]/u;

/**
 * An inline source map at the end of the code, with only whitespace after
 * it, and its base64
 */
const INLINE_MAP =
    /\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([\d+/=A-Za-z]+)\s*$/u;

/** The methods of `vi` whose calls move above the module's code */
const HOISTED = new Set(['hoisted', 'mock', 'unmock']);
/** The methods of `vi` whose paths resolve from the module */
const RESOLVED = new Set([
    'doMock',
    'doUnmock',
    'importActual',
    'mock',
    'unmock'
]);

/** Where `vi` comes from, whose imports stay static, above the mocks */
const HYPOTES = 'hypotes';

/** The registry, from the code of a transformed module */
const MOCKS = `globalThis[Symbol.for(${JSON.stringify(MOCKS_KEY)})]`;
/** The start of a call that resolves the path of a mock from the module */
const RESOLVE = `${MOCKS}.resolvePath(import.meta, `;

const decoder = new TextDecoder();
const require = createRequire(import.meta.url);
let dependencies: Dependencies | undefined;

/**
 * The module, with its mocks hoisted, if it's an ES module outside
 * node_modules that calls `vi` to mock modules
 */
export function hoistModule(url: string, loaded: LoadFnOutput): LoadFnOutput {
    const { format, source } = loaded;
    if (
        source === undefined ||
        (format !== 'module' && format !== 'module-typescript') ||
        !url.startsWith('file:') ||
        url.includes('/node_modules/')
    ) {
        return loaded;
    }

    const text = typeof source === 'string' ? source : decoder.decode(source);
    if (!MOCK_CALL.test(text)) {
        return loaded;
    }

    const hoisted = hoistMocks(splitInlineMap(text), url);
    if (hoisted === undefined) {
        return loaded;
    }

    // Node reads a module's source map as it compiles it, if it maps stack
    // traces then
    if (!getSourceMapsSupport().enabled) {
        setSourceMapsSupport(true);
    }

    return { ...loaded, source: hoisted };
}

/** oxc-parser and magic-string, which load once a module needs them */
function loadDependencies(): Dependencies {
    if (dependencies === undefined) {
        try {
            const { parseSync, Visitor } = require('oxc-parser') as typeof Oxc;
            const { MagicString, SourceMap } =
                require('magic-string') as typeof MagicStringModule;
            dependencies = { MagicString, parseSync, SourceMap, Visitor };
        } catch (error) {
            if ((error as { code?: unknown }).code !== 'MODULE_NOT_FOUND') {
                throw error;
            }
            throw new Error(
                'hypotes/register hoists vi.mock() with oxc-parser and magic-string, its optional peer dependencies, which are missing',
                { cause: error }
            );
        }
    }

    return dependencies;
}

/**
 * The code without the inline source map at its end, and that map, unless
 * it doesn't parse
 */
function splitInlineMap(text: string): MappedCode {
    const match = INLINE_MAP.exec(text);
    if (match === null) {
        return { code: text, map: undefined };
    }

    const code = text.slice(0, match.index);
    try {
        const json = Buffer.from(match[1], 'base64').toString('utf8');
        const payload = JSON.parse(json) as SourceMapPayload;
        return { code, map: new NodeSourceMap(payload) };
    } catch {
        return { code, map: undefined };
    }
}

/**
 * The module's code, with its mocks hoisted, and its source map, chained to
 * the map that the code came with, unless it doesn't parse, which Node
 * reports as it compiles it, or doesn't call `vi`
 */
function hoistMocks(
    { code, map: incoming }: MappedCode,
    url: string
): string | undefined {
    const { MagicString, SourceMap, parseSync, Visitor } = loadDependencies();
    const path = fileURLToPath(url);
    const { errors, module, program } = parseSync(path, code, {
        sourceType: 'module'
    });
    if (errors.length > 0) {
        return undefined;
    }

    const calls = callsOf(program, Visitor);
    if (calls.length === 0) {
        return undefined;
    }

    const hoisted = hoistedStatements(program);
    checkTopLevel(calls, hoisted, code, path);

    const s = new MagicString(code);
    const paths = resolvePaths(s, calls, code);
    wrapDynamicImports(s, module.dynamicImports, paths);
    if (hoisted.length > 0) {
        hoist(s, program, hoisted, code, path);
    }

    const decoded = s.generateDecodedMap({ source: url, hires: 'boundary' });
    const map =
        incoming === undefined
            ? new SourceMap(decoded)
            : chainMap(decoded, incoming, SourceMap);
    return `${s.toString()}\n//# sourceMappingURL=${map.toUrl()}\n`;
}

/**
 * The map of the hoisted code, through the map that the code came with, to
 * where that one maps it. A segment that it doesn't map is left out.
 */
function chainMap(
    map: DecodedSourceMap,
    incoming: NodeSourceMap,
    SourceMap: typeof MagicStringModule.SourceMap
): MagicStringModule.SourceMap {
    const sources = new Indices();
    const names = new Indices();
    const mappings = map.mappings.map(line =>
        chainLine(line, map.names, incoming, sources, names)
    );

    const { payload } = incoming;
    const sourcesContent =
        payload.sourcesContent === undefined
            ? undefined
            : sources.values.map(
                  source =>
                      payload.sourcesContent[payload.sources.indexOf(source)] ??
                      null
              );
    const chained = new SourceMap({
        file: map.file,
        sources: sources.values,
        sourcesContent,
        names: names.values,
        mappings
    });

    // Which magic-string's map doesn't take, and Node's lookups leave out of
    // the sources that they return
    return payload.sourceRoot === undefined
        ? chained
        : Object.assign(chained, { sourceRoot: payload.sourceRoot });
}

/** The segments of a line of the map, through the incoming map */
function chainLine(
    line: readonly SourceMapSegment[],
    mapNames: readonly string[],
    incoming: NodeSourceMap,
    sources: Indices,
    names: Indices
): SourceMapSegment[] {
    const chained: SourceMapSegment[] = [];
    for (const segment of line) {
        if (segment.length === 1) {
            chained.push(segment);
            continue;
        }

        const [column, , originalLine, originalColumn, nameIndex] = segment;
        const entry = incoming.findEntry(originalLine, originalColumn);
        // Node's lookup returns the last entry before the position, which
        // can be on an earlier line
        if (
            !('originalSource' in entry) ||
            entry.generatedLine !== originalLine
        ) {
            continue;
        }

        const name = nameOf(entry, mapNames, nameIndex);
        const position: SourceMapSegment = [
            column,
            sources.indexOf(entry.originalSource),
            entry.originalLine,
            entry.originalColumn
        ];
        chained.push(
            name === undefined ? position : [...position, names.indexOf(name)]
        );
    }

    return chained;
}

/**
 * The name of a chained segment: the incoming map's, which Node's lookup
 * returns, though its types leave it out, or the segment's
 */
function nameOf(
    entry: SourceMapping,
    mapNames: readonly string[],
    nameIndex: number | undefined
): string | undefined {
    const { name } = entry as SourceMapping & { readonly name?: string };
    return name ?? (nameIndex === undefined ? undefined : mapNames[nameIndex]);
}

/** The module's calls of the methods of `vi` that mock, in order */
function callsOf(program: Oxc.Program, Visitor: typeof Oxc.Visitor): Call[] {
    const calls: Call[] = [];
    const visitor = new Visitor({
        CallExpression(node) {
            const method = methodOf(node);
            if (method !== undefined) {
                calls.push({ method, node });
            }
        }
    });

    visitor.visit(program);
    return calls;
}

/** The method of `vi` that the call calls, if it's one that mocks */
function methodOf(node: Oxc.CallExpression): string | undefined {
    const { callee } = node;
    if (
        callee.type !== 'MemberExpression' ||
        callee.computed ||
        callee.object.type !== 'Identifier' ||
        callee.object.name !== 'vi' ||
        callee.property.type !== 'Identifier'
    ) {
        return undefined;
    }

    const { name } = callee.property;
    return HOISTED.has(name) || RESOLVED.has(name) ? name : undefined;
}

/**
 * The statements at the module's top level that call `vi.mock()` or
 * `vi.unmock()`, or `vi.hoisted()`, which can be awaited, and declare what
 * it returns, if the statement declares nothing else: it moves whole
 */
function hoistedStatements(program: Oxc.Program): Hoisted[] {
    const hoisted: Hoisted[] = [];
    for (const statement of program.body) {
        let expression: Oxc.Expression | null | undefined;
        if (statement.type === 'ExpressionStatement') {
            expression = statement.expression;
        } else if (
            statement.type === 'VariableDeclaration' &&
            statement.declarations.length === 1
        ) {
            expression = statement.declarations[0].init;
        }

        const call =
            expression?.type === 'AwaitExpression'
                ? expression.argument
                : expression;
        if (call?.type !== 'CallExpression') {
            continue;
        }

        const method = methodOf(call);
        if (
            method === 'hoisted' ||
            ((method === 'mock' || method === 'unmock') && call === expression)
        ) {
            hoisted.push({ statement, call });
        }
    }

    return hoisted;
}

/**
 * Throws for a call that would be hoisted from outside the top level, where
 * it would run before the code around it, as Vitest's transform does, or
 * from a statement that would take more with it: an export, or other
 * variables
 */
function checkTopLevel(
    calls: readonly Call[],
    hoisted: readonly Hoisted[],
    code: string,
    path: string
): void {
    const topLevel = new Set(hoisted.map(({ call }) => call));
    const nested = calls.filter(
        ({ method, node }) => HOISTED.has(method) && !topLevel.has(node)
    );
    if (nested.length === 0) {
        return;
    }

    const lines = nested.map(({ method, node }) => {
        const [first] = node.arguments;
        const literal =
            first?.type === 'Literal' ? code.slice(first.start, first.end) : '';
        return `- vi.${method}(${literal}) at ${path}:${locationOf(code, node.start)}`;
    });

    throw new SyntaxError(
        [
            `${path} calls vi.mock(), vi.unmock() or vi.hoisted() where they can't be hoisted from:`,
            '',
            ...lines,
            '',
            "They're hoisted above the module's code, so call each in a statement of its own at the module's top level, where it shows when it runs. The statement can declare what vi.hoisted() returns, if it declares nothing else and isn't an export."
        ].join('\n')
    );
}

/** The line and column, from 1, of the offset in the code */
function locationOf(code: string, offset: number): string {
    const before = code.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');

    return `${line}:${column}`;
}

/**
 * Wraps the path of each mock in the registry's `resolvePath()`, which
 * resolves it from the module, and returns where they are.
 * `import('./a.ts')`, which types a mock's factory, is `'./a.ts'`.
 */
function resolvePaths(
    s: MagicString,
    calls: readonly Call[],
    code: string
): Span[] {
    const paths: Span[] = [];
    for (const { method, node } of calls) {
        const [path] = node.arguments;
        if (
            !RESOLVED.has(method) ||
            path === undefined ||
            path.type === 'SpreadElement'
        ) {
            continue;
        }

        const awaited = path.type === 'AwaitExpression' ? path.argument : path;
        if (awaited.type === 'ImportExpression') {
            const { source } = awaited;
            const specifier = code.slice(source.start, source.end);
            s.overwrite(path.start, path.end, `${RESOLVE}${specifier})`);
        } else {
            s.prependRight(path.start, RESOLVE);
            s.appendLeft(path.end, ')');
        }

        paths.push(path);
    }

    return paths;
}

/**
 * Makes each dynamic import wait for the factories of the mocks before it,
 * but those in the paths of mocks, which no longer import
 */
function wrapDynamicImports(
    s: MagicString,
    imports: readonly Span[],
    paths: readonly Span[]
): void {
    for (const { start, end } of imports) {
        if (paths.some(path => start >= path.start && end <= path.end)) {
            continue;
        }

        s.prependRight(start, `${MOCKS}.wrapDynamicImport(() => `);
        s.appendLeft(end, ')');
    }
}

/**
 * Moves the hoisted statements above the module's code, in order, and its
 * imports and exports of other modules after them, as dynamic imports, which
 * wait for the factories of the mocks before them
 */
function hoist(
    s: MagicString,
    program: Oxc.Program,
    hoisted: readonly Hoisted[],
    code: string,
    path: string
): void {
    const loads = program.body.filter(isConverted);
    checkVi(loads, path);
    checkExportAll(loads, code, path);

    // After a hashbang, which comments out the rest of its line
    let index = /^#!.*\r?\n/u.exec(code)?.[0].length ?? 0;
    for (const { statement } of hoisted) {
        const end = lineEnd(code, statement.end);
        if (end === statement.end) {
            s.appendLeft(end, '\n');
        }
        index = moveTo(s, statement.start, end, index);
    }

    for (const [position, node] of loads.entries()) {
        const settle = position === 0 ? `await ${MOCKS}.settle();\n` : '';
        s.overwrite(
            node.start,
            node.end,
            `${settle}${dynamicLoad(node, position, code)}\n`
        );
        index = moveTo(s, node.start, node.end, index);
    }
}

/**
 * Whether the statement loads a module that becomes a dynamic import: an
 * import, or an export of another module's exports, unless it's of types,
 * which Node strips, from hypotes, or of a phase, which a dynamic import
 * can't be
 */
function isConverted(
    statement: Oxc.Program['body'][number]
): statement is Load {
    switch (statement.type) {
        case 'ImportDeclaration':
            return (
                statement.importKind !== 'type' &&
                statement.phase === null &&
                statement.source.value !== HYPOTES
            );
        case 'ExportNamedDeclaration':
            return (
                statement.source !== null &&
                statement.exportKind !== 'type' &&
                statement.source.value !== HYPOTES
            );
        case 'ExportAllDeclaration':
            return (
                statement.exportKind !== 'type' &&
                statement.source.value !== HYPOTES
            );
        default:
            return false;
    }
}

/** Throws if `vi` comes from an import that would follow the mocks */
function checkVi(loads: readonly Load[], path: string): void {
    for (const node of loads) {
        if (node.type !== 'ImportDeclaration') {
            continue;
        }

        const vi = node.specifiers.some(
            specifier =>
                specifier.local.name === 'vi' &&
                !(
                    specifier.type === 'ImportSpecifier' &&
                    specifier.importKind === 'type'
                )
        );
        if (vi) {
            throw new SyntaxError(
                `${path} imports vi from "${node.source.value}", where vi.mock(), vi.unmock() and vi.hoisted() are hoisted above its imports, but those from "${HYPOTES}", which vi has to come from`
            );
        }
    }
}

/**
 * Throws for `export * from`, which names its exports only by loading the
 * module, so it can't follow the mocks, as a dynamic import does
 */
function checkExportAll(
    loads: readonly Load[],
    code: string,
    path: string
): void {
    for (const node of loads) {
        if (node.type === 'ExportAllDeclaration' && node.exported === null) {
            throw new SyntaxError(
                `${path} exports every export of ${code.slice(node.source.start, node.source.end)} at ${path}:${locationOf(code, node.start)}, which would load before the mocks that are hoisted above the module's imports. Export its exports by name, or as a namespace, with "export * as", which load after them.`
            );
        }
    }
}

/** The end of the line on which the offset is, if the line ends there */
function lineEnd(code: string, offset: number): number {
    if (code.startsWith('\r\n', offset)) {
        return offset + 2;
    }

    return code[offset] === '\n' ? offset + 1 : offset;
}

/**
 * Moves the code from start to end to the index, after what moved there
 * before, unless it's there, and returns where the next moves to
 */
function moveTo(
    s: MagicString,
    start: number,
    end: number,
    index: number
): number {
    if (index === start || index === end) {
        return end;
    }

    s.move(start, end, index);
    return index;
}

/**
 * The statement, as a dynamic import that declares its bindings as
 * constants, and exports those that it exports. `position` tells its
 * constants from those of the module's other statements.
 */
function dynamicLoad(node: Load, position: number, code: string): string {
    const sliceOf = ({ start, end }: Span): string => code.slice(start, end);
    const attributes = node.attributes.map(
        ({ key, value }) => `${sliceOf(key)}: ${sliceOf(value)}`
    );
    const options =
        attributes.length > 0 ? `, { with: { ${attributes.join(', ')} } }` : '';
    const load = `await import(${sliceOf(node.source)}${options})`;

    switch (node.type) {
        case 'ImportDeclaration':
            return importOf(node, load, sliceOf);
        case 'ExportNamedDeclaration':
            return exportOf(node, load, position, sliceOf);
        default: {
            // `export * as`, since `checkExportAll` threw for `export *`
            const local = `__hypotes_export_${position}__`;
            const exported = sliceOf(node.exported as Span);
            return `const ${local} = ${load}; export { ${local} as ${exported} };`;
        }
    }
}

/** The import's bindings, declared from what `load` imports */
function importOf(
    node: Oxc.ImportDeclaration,
    load: string,
    sliceOf: (span: Span) => string
): string {
    let namespace: string | undefined;
    const properties: string[] = [];
    for (const specifier of node.specifiers) {
        const local = specifier.local.name;
        if (specifier.type === 'ImportNamespaceSpecifier') {
            namespace = local;
        } else if (specifier.type === 'ImportDefaultSpecifier') {
            properties.push(`default: ${local}`);
        } else if (specifier.importKind !== 'type') {
            const imported = sliceOf(specifier.imported);
            properties.push(
                imported === local ? local : `${imported}: ${local}`
            );
        }
    }

    const pattern = `{ ${properties.join(', ')} }`;
    if (namespace !== undefined) {
        return properties.length > 0
            ? `const ${namespace} = ${load}, ${pattern} = ${namespace};`
            : `const ${namespace} = ${load};`;
    }

    return properties.length > 0 ? `const ${pattern} = ${load};` : `${load};`;
}

/**
 * The exports of `export { a as b } from`, from constants of what `load`
 * imports, on one line, as the statement was
 */
function exportOf(
    node: ExportFrom,
    load: string,
    position: number,
    sliceOf: (span: Span) => string
): string {
    const properties: string[] = [];
    const exports: string[] = [];
    for (const [index, specifier] of node.specifiers.entries()) {
        if (specifier.exportKind !== 'type') {
            const local = `__hypotes_export_${position}_${index}__`;
            properties.push(`${sliceOf(specifier.local)}: ${local}`);
            exports.push(`${local} as ${sliceOf(specifier.exported)}`);
        }
    }

    return properties.length > 0
        ? `const { ${properties.join(', ')} } = ${load}; export { ${exports.join(', ')} };`
        : `${load};`;
}
