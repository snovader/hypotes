// The snapshots of the test files that a process runs, on @vitest/snapshot,
// which Vitest's are on: its runner's part, of which node:test has none.
// Vitest's runner reads a test file's snapshots before its tests, and saves
// them after them. Here, a file's snapshots are read once a test of it calls
// a snapshot matcher, and saved in an `after` hook of node:test's root, which
// is added then: a test file that has no snapshots loads none of this, and
// has no hook. The root's hooks run once every test ended, whether or not
// they passed, and before node:test ends the process, with
// `--test-force-exit` too. In one process, with `--test-isolation=none`, each
// file's hook saves its snapshots once the tests of all of them ended.
//
// Where it differs from Vitest:
//
// - Vitest takes whether to update from its `--update` flag, and from
//   UPDATE_SNAPSHOT. Here it's UPDATE_SNAPSHOT, as Vitest reads it, or
//   node:test's flag, `--test-update-snapshots`, which node:test passes on
//   to the process of each test file.
// - Vitest writes no new snapshots where std-env finds a CI, which knows
//   those that don't set `CI`. Here it's where `CI` is set.
// - A test that didn't run keeps its snapshots: one skipped, as in Vitest,
//   but also one to do, or one whose hook failed before it.
// - Vitest's reporter counts the snapshots of the run. node:test reports
//   diagnostics, so each test file whose snapshots were written, updated,
//   or are obsolete says so in one.
import { AsyncResource } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative } from 'node:path';
import * as nodeTest from 'node:test';
import { pathToFileURL } from 'node:url';
import { equals, iterableEquality, subsetEquality } from '@vitest/expect';
import type * as Snapshot from '@vitest/snapshot';
import type * as SnapshotEnvironment from '@vitest/snapshot/environment';
import { unrunNames } from './declared.ts';
import { callFrom, type Site } from './site.ts';

type SnapshotClient = Snapshot.SnapshotClient;
type SnapshotResult = Snapshot.SnapshotResult;
type SnapshotState = Snapshot.SnapshotState;
type SnapshotStateOptions = Snapshot.SnapshotStateOptions;
type SnapshotUpdateState = SnapshotStateOptions['updateSnapshot'];

/** A serializer of snapshots: a plugin of @vitest/pretty-format */
export type SnapshotSerializer = Parameters<typeof Snapshot.addSerializer>[0];

/**
 * The constructor of a file's snapshots, which @vitest/snapshot keeps to
 * `SnapshotState.create()`: that reads the file's snapshots through
 * promises, and a snapshot matcher answers without awaiting. It takes what
 * `create()` passes it.
 */
type SnapshotStateConstructor = new (
    testFilePath: string,
    snapshotPath: string,
    snapshots: Record<string, string> | null,
    options: SnapshotStateOptions
) => SnapshotState;

/** The header of the snapshot files that Vitest writes */
const HEADER = '// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html';

const require = createRequire(import.meta.url);

let loaded: typeof Snapshot | undefined;

/** @vitest/snapshot, which loads once a test asks for a snapshot */
function load(): typeof Snapshot {
    loaded ??= require('@vitest/snapshot') as typeof Snapshot;

    return loaded;
}

/**
 * Whether snapshots are written: all that differ, only new ones, or none.
 * As in Vitest, UPDATE_SNAPSHOT names one of them, or asks for all with
 * another value, and otherwise only a CI writes none.
 */
function updateState(): SnapshotUpdateState {
    const asked = process.env['UPDATE_SNAPSHOT'];
    if (asked === 'all' || asked === 'new' || asked === 'none') {
        return asked;
    }
    if (asked || process.execArgv.includes('--test-update-snapshots')) {
        return 'all';
    }

    return process.env['CI'] ? 'none' : 'new';
}

/** The text of a file, or null if there is no such file */
function readIfExists(path: string): string | null {
    try {
        return readFileSync(path, 'utf8');
    } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/** A count and what it counts, or nothing for none */
function counted(count: number, what: string): string[] {
    return count > 0 ? [`${count} ${what}`] : [];
}

/**
 * What a test file's snapshots came to, for those that were written or
 * that no test asked for, and nothing if they only matched. It names the
 * obsolete ones where they're kept, and nothing else does: an update removes
 * them, and the error of a run that writes none names them.
 */
function describeResult(
    result: SnapshotResult,
    update: SnapshotUpdateState
): string[] {
    const { added, updated, unchecked, uncheckedKeys, fileDeleted } = result;
    // A file whose last snapshots went counts none of them as unchecked
    const obsolete = fileDeleted ? uncheckedKeys.length : unchecked;
    const counts = [
        ...counted(added, 'written'),
        ...counted(updated, 'updated'),
        ...counted(obsolete, update === 'all' ? 'removed' : 'obsolete')
    ];
    if (counts.length === 0) {
        return [];
    }

    const file = relative(process.cwd(), result.filepath);
    const keys =
        update === 'new'
            ? uncheckedKeys.map(key => `obsolete snapshot of ${file}: ${key}`)
            : [];

    return [`snapshots of ${file}: ${counts.join(', ')}`, ...keys];
}

/**
 * The error that Vitest fails a test file with where it writes no snapshots,
 * and the file has some that no test asked for
 */
function obsoleteError(result: SnapshotResult): Error {
    const lines = result.uncheckedKeys.map(key => `· ${key}\n`);

    return new Error(
        `Obsolete snapshots found when no snapshot update is expected.\n${lines.join('')}`
    );
}

/** The snapshots of the test files that the process runs */
class SnapshotSession {
    readonly #client: SnapshotClient;
    readonly #State: SnapshotStateConstructor;
    readonly #evaluate: typeof SnapshotEnvironment.evaluateSnapshotFile;
    readonly #options: SnapshotStateOptions;

    constructor() {
        const { SnapshotClient, SnapshotState } = load();
        const { NodeSnapshotEnvironment, evaluateSnapshotFile } =
            require('@vitest/snapshot/environment') as typeof SnapshotEnvironment;

        this.#client = new SnapshotClient({
            // As Vitest compares a value with the properties to match
            isEqual: (received, expected) =>
                equals(received, expected, [iterableEquality, subsetEquality])
        });
        this.#State = SnapshotState as unknown as SnapshotStateConstructor;
        this.#evaluate = evaluateSnapshotFile;
        this.#options = {
            updateSnapshot: updateState(),
            snapshotEnvironment: Object.assign(new NodeSnapshotEnvironment(), {
                getHeader: () => HEADER
            })
        };
    }

    /**
     * @vitest/snapshot's client, with the snapshots of the test file, which
     * are read as the first of its tests asks for them
     */
    clientOf(testFile: string): SnapshotClient {
        const states = this.#client.snapshotStateMap;
        if (!states.has(testFile)) {
            states.set(testFile, this.#read(testFile));
            this.#saveLater(testFile);
        }

        return this.#client;
    }

    /** The snapshots of a test file, from where Vitest keeps them */
    #read(testFile: string): SnapshotState {
        const path = join(
            dirname(testFile),
            '__snapshots__',
            `${basename(testFile)}.snap`
        );
        const content = readIfExists(path);
        const snapshots =
            content == null ? null : this.#evaluate(path, content);

        return new this.#State(testFile, path, snapshots, this.#options);
    }

    /**
     * Saves the test file's snapshots once node:test has run every test, in
     * a hook that node:test takes for the file's own: it names a hook that
     * fails by the file that declared it
     */
    #saveLater(testFile: string): void {
        const site: Site = {
            scriptName: pathToFileURL(testFile).href,
            lineNumber: 1,
            columnNumber: 1
        };
        // node:test adds a hook to the test that is running, which it finds
        // by the id of what is executing. Outside any test's, it's the
        // root's.
        const outside = new AsyncResource('hypotes.snapshots', {
            triggerAsyncId: 0
        });
        outside.runInAsyncScope(() => {
            callFrom(site, nodeTest.after, context =>
                // The root's context is a test's, which reports diagnostics
                this.#save(testFile, context as nodeTest.TestContext)
            );
        });
    }

    /**
     * Saves the snapshots of the test file, reports what was written, and
     * throws Vitest's error if snapshots are obsolete where none is written
     */
    async #save(
        testFile: string,
        context: nodeTest.TestContext
    ): Promise<void> {
        const client = this.#client;
        const update = this.#options.updateSnapshot;

        for (const name of unrunNames()) {
            client.skipTest(testFile, name);
        }
        const result = await client.finish(testFile);

        for (const line of describeResult(result, update)) {
            context.diagnostic(line);
        }
        if (update === 'none' && result.unchecked > 0) {
            throw obsoleteError(result);
        }
    }
}

let session: SnapshotSession | undefined;

function currentSession(): SnapshotSession {
    session ??= new SnapshotSession();

    return session;
}

/**
 * @vitest/snapshot's client, with the snapshots of the test file. It loads
 * @vitest/snapshot when first called, and saves the snapshots that it reads
 * once node:test has run the tests.
 */
export function snapshotClient(testFile: string): SnapshotClient {
    return currentSession().clientOf(testFile);
}

/** Adds a serializer, which snapshots try before those that they have */
export function addSnapshotSerializer(serializer: SnapshotSerializer): void {
    load().addSerializer(serializer);
}

/**
 * An inline snapshot as it was before the test file indented it, which is
 * how @vitest/snapshot writes it there
 */
export function stripSnapshotIndentation(snapshot: string): string {
    return load().stripSnapshotIndentation(snapshot);
}
