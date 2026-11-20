// The source map of a module that `hoist.ts` transforms, chained to the
// inline source map that it came with. A hook that runs after
// `hypotes/register`, through its `nextLoad`, such as one that strips
// TypeScript, can end the module with one. Node reads only a module's last
// source map, so the map of the hoisted code maps through it, to where it
// maps that code.
//
// A position maps through the last segment of the incoming map at or before
// it on the same line; one on a line that the incoming map doesn't map is
// left out, as are the segments of the incoming map that map to no source.
// An index map's sections are flattened: each section's segments move to
// where it starts, and its sources and names follow the sections' before it.
// The sources keep the names that the incoming map gives them, with its
// `sourceRoot`; those of an index map's sections keep their names without
// theirs. A map that doesn't parse, or isn't a source map, is dropped, as
// Node would ignore it, and the hoisted code then maps to the code as it's
// given.
//
// This decodes the incoming map itself, rather than with Node's `SourceMap`,
// whose construction took most of the time of chaining.
import { Buffer } from 'node:buffer';
import type * as MagicStringModule from 'magic-string';

type DecodedSourceMap = MagicStringModule.DecodedSourceMap;
type SourceMapSegment = MagicStringModule.SourceMapSegment;

/** The fields of a map of one module that chaining reads */
interface ModuleSourceMap {
    readonly sources: ReadonlyArray<string | null>;
    readonly mappings: string;
    readonly names?: readonly string[];
    readonly sourceRoot?: string;
    readonly sourcesContent?: ReadonlyArray<string | null>;
}

/** A map of a part of a module, from where the part starts */
interface Section {
    readonly offset: { readonly line: number; readonly column: number };
    readonly map: ModuleSourceMap;
}

/** A map of a module in sections, each of which maps a part of it */
interface IndexSourceMap {
    readonly sections: readonly Section[];
}

/** A source map that a hook after `hypotes/register` appended */
export type IncomingSourceMap = IndexSourceMap | ModuleSourceMap;

/** A module's code, and the inline source map that it ended with, if any */
export interface MappedCode {
    readonly code: string;
    readonly map: IncomingSourceMap | undefined;
}

/** A chained map, decoded, and the `sourceRoot` of its sources, if any */
export interface ChainedSourceMap extends DecodedSourceMap {
    readonly sourceRoot?: string;
}

/**
 * The segments of each line of a map that map to a source, each as
 * `STRIDE` numbers: its column, the index of its source, the line and
 * column in the source, all from 0, and the index of its name, or -1. A
 * line without such segments is empty, so that the array has no holes,
 * which V8 reads more slowly.
 */
type Lines = number[][];

/** The incoming map, decoded by line, with what its segments index */
interface MapIndex {
    readonly lines: Lines;
    readonly sources: ReadonlyArray<string | null>;
    readonly sourcesContent: ReadonlyArray<string | null> | undefined;
    readonly names: readonly string[];
}

/**
 * What decoded positions move by: the column of the first line, where a
 * section of an index map starts, and the indices of its first source and
 * name among the sections'
 */
interface DecodeOffset {
    readonly column: number;
    readonly source: number;
    readonly name: number;
}

const STRIDE = 5;

const SOURCE_MAPPING_URL = '//# sourceMappingURL=';
/** The starts of a source map's base64 data URL, as tools write it */
const DATA_URLS = [
    'data:application/json;base64,',
    'data:application/json;charset=utf-8;base64,'
];

const COMMA = 0x2c;
const SEMICOLON = 0x3b;

const NO_OFFSET: DecodeOffset = { column: 0, source: 0, name: 0 };

/**
 * The code without the inline source map at its end, and that map, unless
 * it doesn't parse or isn't a source map. A map comment that isn't on the
 * code's last line, but for whitespace, stays in the code.
 */
export function splitInlineMap(text: string): MappedCode {
    const end = trimmedEnd(text);
    // Most modules end in `}` or `;`, which can't end the map's base64, and
    // need no search of their code
    if (end === 0 || !isBase64Digit(text.codePointAt(end - 1) ?? 0)) {
        return { code: text, map: undefined };
    }

    const index = lastIndexOf(text, SOURCE_MAPPING_URL);
    if (index === -1) {
        return { code: text, map: undefined };
    }

    const data = dataUrlData(text, index + SOURCE_MAPPING_URL.length, end);
    if (data === undefined) {
        return { code: text, map: undefined };
    }

    // Buffer skips characters that aren't base64, and JSON.parse() then
    // rejects what's left
    const code = text.slice(0, index);
    try {
        const json = Buffer.from(data, 'base64').toString('utf8');
        const map: unknown = JSON.parse(json);
        return { code, map: isIncomingSourceMap(map) ? map : undefined };
    } catch {
        return { code, map: undefined };
    }
}

/**
 * The decoded map of the hoisted code, through the incoming map, to where
 * that one maps it
 */
export function chainSourceMap(
    map: DecodedSourceMap,
    incoming: IncomingSourceMap
): ChainedSourceMap {
    const index = indexSourceMap(incoming);
    const sources = new IndexedSources(index.sources);
    const names = new Names();
    const mappings = map.mappings.map(line =>
        chainLine(line, map.names, index, sources, names)
    );

    const { sourcesContent } = index;
    const sourceRoot =
        'sources' in incoming && typeof incoming.sourceRoot === 'string'
            ? { sourceRoot: incoming.sourceRoot }
            : {};
    return {
        file: map.file,
        ...sourceRoot,
        sources: sources.values(),
        sourcesContent:
            sourcesContent === undefined
                ? undefined
                : sources
                      .indices()
                      .map(source => sourcesContent[source] ?? null),
        names: names.values(),
        mappings
    };
}

/**
 * The segments of a line of the map of the hoisted code, through the
 * incoming map. A segment without a source stays as it is. A segment's name
 * is the incoming map's, or its own.
 */
function chainLine(
    line: readonly SourceMapSegment[],
    mapNames: readonly string[],
    index: MapIndex,
    sources: IndexedSources,
    names: Names
): SourceMapSegment[] {
    const chained: SourceMapSegment[] = [];
    for (const segment of line) {
        if (segment.length === 1) {
            chained.push(segment);
            continue;
        }

        const [column, , originalLine, originalColumn, nameIndex] = segment;
        const segments = index.lines[originalLine];
        if (segments === undefined) {
            continue;
        }

        const found = findSegment(segments, originalColumn);
        if (found === -1) {
            continue;
        }

        const source = sources.indexOf(segments[found + 1]);
        const incomingName = segments[found + 4];
        const name =
            incomingName === -1
                ? nameIndex === undefined
                    ? undefined
                    : mapNames[nameIndex]
                : index.names[incomingName];
        chained.push(
            name === undefined
                ? [column, source, segments[found + 2], segments[found + 3]]
                : [
                      column,
                      source,
                      segments[found + 2],
                      segments[found + 3],
                      names.indexOf(name)
                  ]
        );
    }

    return chained;
}

/** Where the whitespace at the end of the text starts */
function trimmedEnd(text: string): number {
    let end = text.length;
    while (end > 0 && isWhitespace(text.codePointAt(end - 1) ?? 0)) {
        end--;
    }

    return end;
}

function isWhitespace(code: number): boolean {
    // Tab, line feed, carriage return, space
    return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

/** Whether the code is that of a digit of base64, or its padding */
function isBase64Digit(code: number): boolean {
    return (
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x2b ||
        code === 0x2f ||
        code === 0x3d
    );
}

/**
 * The index of the last occurrence of the search string, which this finds
 * by searching forwards from each occurrence: V8 searches forwards several
 * times as fast as backwards, through a map's base64 as well
 */
function lastIndexOf(text: string, search: string): number {
    let index = text.indexOf(search);
    if (index === -1) {
        return -1;
    }

    let next = text.indexOf(search, index + 1);
    while (next !== -1) {
        index = next;
        next = text.indexOf(search, index + 1);
    }

    return index;
}

/**
 * The data of a base64 data URL of JSON from the start up to the end, if
 * the URL is one, and on the text's last line
 */
function dataUrlData(
    text: string,
    start: number,
    end: number
): string | undefined {
    const prefix = DATA_URLS.find(url => text.startsWith(url, start));
    if (prefix === undefined) {
        return undefined;
    }

    const dataStart = start + prefix.length;
    const lineEnd = text.indexOf('\n', dataStart);
    if (lineEnd !== -1 && lineEnd < end) {
        return undefined;
    }

    return text.slice(dataStart, end);
}

function isIncomingSourceMap(value: unknown): value is IncomingSourceMap {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    if ('sections' in value) {
        return Array.isArray(value.sections) && value.sections.every(isSection);
    }

    return isModuleSourceMap(value);
}

function isSection(value: unknown): value is Section {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const { offset, map } = value as Partial<Record<keyof Section, unknown>>;
    return (
        typeof offset === 'object' &&
        offset !== null &&
        Number.isInteger((offset as { line?: unknown }).line) &&
        Number.isInteger((offset as { column?: unknown }).column) &&
        isModuleSourceMap(map)
    );
}

function isModuleSourceMap(value: unknown): value is ModuleSourceMap {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const { sources, mappings, names, sourcesContent } = value as Partial<
        Record<keyof ModuleSourceMap, unknown>
    >;
    return (
        typeof mappings === 'string' &&
        Array.isArray(sources) &&
        (names === undefined || Array.isArray(names)) &&
        (sourcesContent === undefined || Array.isArray(sourcesContent))
    );
}

/**
 * Decodes the incoming map by line, with the segments of each section of an
 * index map moved to where the section starts
 */
function indexSourceMap(map: IncomingSourceMap): MapIndex {
    if (!('sections' in map)) {
        return {
            lines: decodeMappings(map.mappings, NO_OFFSET),
            sources: map.sources,
            sourcesContent: map.sourcesContent,
            names: map.names ?? []
        };
    }

    const lines: Lines = [];
    const sources: Array<string | null> = [];
    const sourcesContent: Array<string | null> = [];
    const names: string[] = [];
    let hasContent = false;
    for (const { offset, map: section } of map.sections) {
        const decoded = decodeMappings(section.mappings, {
            column: offset.column,
            source: sources.length,
            name: names.length
        });
        addSection(lines, decoded, offset.line);

        hasContent ||= section.sourcesContent !== undefined;
        for (const [index, source] of section.sources.entries()) {
            sources.push(source);
            sourcesContent.push(section.sourcesContent?.[index] ?? null);
        }
        names.push(...(section.names ?? []));
    }

    return {
        lines,
        sources,
        sourcesContent: hasContent ? sourcesContent : undefined,
        names
    };
}

/**
 * Adds the lines of a section from the line where it starts, where the
 * section before it may end
 */
function addSection(lines: Lines, section: Lines, start: number): void {
    while (lines.length < start) {
        lines.push([]);
    }

    for (const [index, segments] of section.entries()) {
        const line = lines[start + index];
        if (line === undefined) {
            lines.push(segments);
        } else {
            line.push(...segments);
        }
    }
}

/**
 * Decodes the segments of mappings that map to a source, by line, moved by
 * the offset. Invalid mappings decode to positions that map nowhere useful,
 * rather than throwing, as Node's own decoding does.
 */
function decodeMappings(mappings: string, offset: DecodeOffset): Lines {
    const { length } = mappings;
    const lines: Lines = [];
    const fields = [0, 0, 0, 0, 0];
    let segments: number[] = [];
    let fieldCount = 0;
    let column = offset.column;
    let source = offset.source;
    let originalLine = 0;
    let originalColumn = 0;
    let name = offset.name;
    let value = 0;
    let shift = 0;

    for (let index = 0; index <= length; index++) {
        // A semicolon past the end ends the last line. Reading a character
        // there instead took a third of the time of chaining a small map,
        // and codePointAt() a quarter, though the mappings are base64.
        // oxlint-disable-next-line unicorn/prefer-code-point -- As above
        const char = index < length ? mappings.charCodeAt(index) : SEMICOLON;

        if (char === COMMA || char === SEMICOLON) {
            if (fieldCount > 0) {
                column += fields[0];
            }
            if (fieldCount >= 4) {
                source += fields[1];
                originalLine += fields[2];
                originalColumn += fields[3];
                if (fieldCount >= 5) {
                    name += fields[4];
                }
                segments.push(
                    column,
                    source,
                    originalLine,
                    originalColumn,
                    fieldCount >= 5 ? name : -1
                );
            }
            fieldCount = 0;

            if (char === SEMICOLON) {
                lines.push(segments);
                segments = [];
                column = 0;
            }
            continue;
        }

        // Each digit holds five bits of the value, and whether more follow
        const digit = base64Value(char);
        value += (digit & 31) << shift;
        if ((digit & 32) === 0) {
            fields[fieldCount++] = value & 1 ? -(value >>> 1) : value >>> 1;
            value = 0;
            shift = 0;
        } else {
            shift += 5;
        }
    }

    return lines;
}

/** The value of a base64 digit, from its code */
function base64Value(code: number): number {
    if (code >= 0x61) {
        // a-z
        return code - 0x61 + 26;
    }
    if (code >= 0x41) {
        // A-Z
        return code - 0x41;
    }
    if (code >= 0x30) {
        // 0-9
        return code - 0x30 + 52;
    }

    return code === 0x2b ? 62 : 63;
}

/**
 * The offset in a line's segments of the last segment at or before the
 * column, or -1, by a binary search of the segments, which are in order
 */
function findSegment(segments: readonly number[], column: number): number {
    let low = 0;
    let high = segments.length / STRIDE - 1;
    let found = -1;

    while (low <= high) {
        const middle = (low + high) >>> 1;
        if (segments[middle * STRIDE] <= column) {
            found = middle * STRIDE;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return found;
}

/**
 * The sources of the incoming map that the chained map refers to, in the
 * order that they're first referred to
 */
class IndexedSources {
    readonly #incoming: ReadonlyArray<string | null>;
    /** The index of each incoming source among the chained map's, or -1 */
    readonly #indices: Int32Array;
    readonly #values: Array<string | null> = [];
    readonly #incomingIndices: number[] = [];

    constructor(incoming: ReadonlyArray<string | null>) {
        this.#incoming = incoming;
        this.#indices = new Int32Array(incoming.length).fill(-1);
    }

    /** The index in the chained map of the incoming source at the index */
    indexOf(incoming: number): number {
        let index = this.#indices[incoming];
        if (index === -1) {
            index = this.#values.push(this.#incoming[incoming] ?? null) - 1;
            this.#incomingIndices.push(incoming);
            this.#indices[incoming] = index;
        }

        return index;
    }

    /**
     * The sources, by their index in the chained map. One may be null, as
     * in the incoming map, which magic-string's types leave out.
     */
    values(): string[] {
        return this.#values as string[];
    }

    /** The index of each source in the incoming map */
    indices(): readonly number[] {
        return this.#incomingIndices;
    }
}

/** The names of the chained map, in the order that they're first given */
class Names {
    readonly #indices = new Map<string, number>();
    readonly #values: string[] = [];

    indexOf(name: string): number {
        let index = this.#indices.get(name);
        if (index === undefined) {
            index = this.#values.push(name) - 1;
            this.#indices.set(name, index);
        }

        return index;
    }

    values(): string[] {
        return this.#values;
    }
}
