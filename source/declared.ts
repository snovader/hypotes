// The tests and the suites that were declared but haven't run: skipped, to
// do without a function, or left out by `--test-name-pattern` or `only`.
// Their snapshots aren't obsolete, which `snapshot-session.ts` asks for as
// a test file ends: Vitest's runner knows each test that it skipped, where
// node:test says nothing of a test until it runs.
//
// node:test doesn't call the function of a skipped suite, so the tests in
// it are never declared: the suite itself stands for them.
import { AsyncLocalStorage } from 'node:async_hooks';

/** A test or a suite, as it was declared in its suite */
export class Declaration {
    readonly #parent: Declaration | undefined;
    readonly #name: string;

    constructor(parent: Declaration | undefined, name: string) {
        this.#parent = parent;
        this.#name = name;
    }

    /** The names of its suites and its own, joined by ' > ', as node:test's */
    fullName(): string {
        const parent = this.#parent;

        return parent == null
            ? this.#name
            : `${parent.fullName()} > ${this.#name}`;
    }
}

/** The suite whose function is declaring tests */
const suites = new AsyncLocalStorage<Declaration>();

const unrun = new Set<Declaration>();

/** Declares a test or a suite of the name, in the suite that is declaring */
export function declare(name: string): Declaration {
    const declaration = new Declaration(suites.getStore(), name);
    unrun.add(declaration);

    return declaration;
}

/** Marks the test as run, as node:test calls its function */
export function startTest(test: Declaration): void {
    unrun.delete(test);
}

/** Calls the suite's function, which declares what is in the suite */
export function declareIn<T>(suite: Declaration, fn: () => T): T {
    unrun.delete(suite);

    return suites.run(suite, fn);
}

/**
 * The full names of the tests, and of the suites, that were declared in the
 * process, and that node:test hasn't run
 */
export function unrunNames(): string[] {
    return Array.from(unrun, declaration => declaration.fullName());
}
