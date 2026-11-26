// node:test records where each test was declared as the position of the
// code that called it, which would be this package's. Reporters print it,
// as `test at file:line:column`, and JUnit's names the file of each test with
// it. So each declaration calls node:test from a function compiled at the
// position of the code that called this package, which it records instead.
import { getCallSites } from 'node:util';
import { compileFunction } from 'node:vm';

/** Where a test or a suite was declared */
export interface Site {
    readonly scriptName: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
}

/** A function of node:test's that declares, such as `it` or `after` */
type Register<Args extends readonly unknown[]> = (...args: Args) => unknown;
type Caller = (
    register: Register<readonly unknown[]>,
    args: readonly unknown[]
) => unknown;

/** The functions compiled at each site, which each row of `.each` shares */
const callers = new Map<string, Caller>();

/**
 * The position of the code that called the function that calls this: the
 * test file's, when that function is one that a test file calls. It's the
 * position that node:test takes for the one where a test is written: the one
 * that a source map maps it to, as in a module that `hypotes/register`
 * transforms, unless node:test maps it itself, as it does with
 * `--enable-source-maps`.
 */
export function callerSite(): Site | undefined {
    // This function, the one that calls it, then the one that calls that
    const compiled = getCallSites(3, { sourceMap: false })[2];
    if (!compiled?.scriptName) {
        return undefined;
    }

    const written = getCallSites(3, { sourceMap: true })[2];
    if (isSamePosition(compiled, written)) {
        return compiled;
    }

    // Node maps call sites unasked only with `--enable-source-maps`, with
    // which node:test maps the site of each test too
    const mapsSites = isSamePosition(getCallSites(3)[2], written);
    return mapsSites ? compiled : written;
}

function isSamePosition(a: Site, b: Site): boolean {
    return (
        a.lineNumber === b.lineNumber &&
        a.columnNumber === b.columnNumber &&
        a.scriptName === b.scriptName
    );
}

/**
 * Calls `register`, which declares through node:test, from code at the
 * site, if there is one
 */
export function callFrom<Args extends readonly unknown[]>(
    site: Site | undefined,
    register: Register<Args>,
    ...args: Args
): unknown {
    if (site == null) {
        return register(...args);
    }

    const key = `${site.scriptName}:${site.lineNumber}:${site.columnNumber}`;
    let caller = callers.get(key);
    if (caller == null) {
        caller = compileCaller(site);
        callers.set(key, caller);
    }

    return caller(register as Register<readonly unknown[]>, args);
}

/** A function whose call to `register` lies at the site */
function compileCaller(site: Site): Caller {
    // The call starts the body's second line, which `lineOffset` puts at the
    // site's line, indented to its column
    const indent = ' '.repeat(site.columnNumber - 1);
    const body = `return (\n${indent}register(...args));`;

    return compileFunction(body, ['register', 'args'], {
        filename: site.scriptName,
        lineOffset: site.lineNumber - 2
    }) as Caller;
}
