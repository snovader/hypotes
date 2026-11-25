// Reads an error's stack as text, as a reporter has it: node:test passes a
// test's error from the test file's process, with the stack that V8 wrote
// there. So its positions are already where the code is written, for
// TypeScript whose types Node strips, which keeps each position, and for a
// module that `hypotes/register` transforms, which has Node map stack traces
// by its source map. Nothing here maps them.
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A position in a file, with its line and column from 1 */
export interface Position {
    /** The file's absolute path */
    readonly file: string;
    readonly line: number;
    readonly column: number;
}

/** An error's stack, apart */
export interface ParsedStack {
    /** What comes before the frames: the error's name and its message */
    readonly head: string;
    /** The frames in the project's own code, from the innermost */
    readonly frames: readonly Position[];
}

/**
 * A frame's line with the name of its function, as V8 writes it:
 * `    at name (file:line:column)`. Its file may have colons of its own, as
 * a URL or a Windows path does.
 */
const NAMED_FRAME = /^\s+at .*? \((.+):(\d+):(\d+)\)$/;

/** A frame's line without a name, as `    at async file:line:column` */
const BARE_FRAME = /^\s+at (?:async )?(.+):(\d+):(\d+)$/;

/** Where the frames of a stack start */
const FIRST_FRAME = /^\s+at /m;

/** A directory of installed packages in a path, with either separator */
const NODE_MODULES = /[/\\]node_modules[/\\]/;

/**
 * The stack's head and its frames in the project's own code: those in a
 * file with an absolute path or a `file:` URL, outside `node_modules`. That
 * leaves out Node's internals, and code without a file, such as an `eval`'s.
 * A stack without frames is all head.
 */
export function parseStack(stack: string): ParsedStack {
    const start = FIRST_FRAME.exec(stack)?.index ?? stack.length;
    const frames: Position[] = [];

    for (const line of stack.slice(start).split('\n')) {
        const frame = parseFrame(line);

        if (frame != null) {
            frames.push(frame);
        }
    }

    return { head: stack.slice(0, start).trimEnd(), frames };
}

/** The position of a frame in the project's own code, if the line is one */
function parseFrame(line: string): Position | undefined {
    // A bare frame doesn't end in a parenthesis, which a named one does
    const match = BARE_FRAME.exec(line) ?? NAMED_FRAME.exec(line);
    if (match == null) {
        return undefined;
    }

    const file = toPath(match[1]);
    if (file == null || NODE_MODULES.test(file)) {
        return undefined;
    }

    return { file, line: Number(match[2]), column: Number(match[3]) };
}

/**
 * The absolute path that a frame names, as a path or as a `file:` URL, or
 * nothing for any other name, as `node:internal/timers`
 */
function toPath(name: string): string | undefined {
    if (name.startsWith('file://')) {
        try {
            return fileURLToPath(name);
        } catch {
            // A URL of another platform's, such as one with a host
            return undefined;
        }
    }

    // Which takes a POSIX path for absolute too, on each platform
    return win32.isAbsolute(name) ? name : undefined;
}
