// The snapshot matchers, in runs of the fixtures in `fixtures/snapshots`, in
// another process: each run works on a copy of them in a temporary
// directory, which it writes snapshots to, and which is removed after it.
//
// `fixtures/snapshots-by-vitest` has what Vitest 5.1.2 wrote for the same
// files, from the same state, with these changes to the files, and back:
// `hypotes` to `vitest` in their imports, and in `concurrent.ts`, Vitest's
// `concurrent` option for `concurrency`, and its context's `expect` in each
// test. It has each file that Vitest wrote or changed, a test file under its
// name and `.txt`. `golden/crlf.txt` is written here, as git keeps no CRLF.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'hypotes';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = fileURLToPath(new URL('fixtures/snapshots', import.meta.url));
const BY_VITEST = fileURLToPath(new URL('fixtures/snapshots-by-vitest', import.meta.url));

const CRLF = 'a\r\nb\r\n';

/** The fixtures' test files, of which two fail in each run, on purpose */
const TEST_FILES = [
    'basic.ts',
    'changes.ts',
    'concurrent.ts',
    'file.ts',
    'inline.ts',
    'misuse.ts',
    'mocked.ts'
];

/** The tests of `misuse.ts` that fail whatever the snapshots are */
const FAILING = ['fails', 'soft'];

/** The content of each file in a directory, by its path from it, with `/` */
type Tree = Record<string, string>;

function treeOf(directory: string): Tree {
    const entries = readdirSync(directory, { recursive: true, withFileTypes: true });
    const files = entries
        .filter(entry => entry.isFile())
        .map(entry => join(entry.parentPath, entry.name));

    return Object.fromEntries(
        files
            .sort()
            .map(file => [
                relative(directory, file).split(sep).join('/'),
                readFileSync(file, 'utf8')
            ])
    );
}

/** The fixtures as they are before a run */
function pristine(): Tree {
    return { ...treeOf(FIXTURES), 'golden/crlf.txt': CRLF };
}

/** The fixtures as Vitest leaves them after a run from the pristine ones */
function writtenByVitest(): Tree {
    const written = Object.entries(treeOf(BY_VITEST)).map(([path, content]): [string, string] => [
        path.endsWith('.ts.txt') ? path.slice(0, -'.txt'.length) : path,
        content
    ]);

    return { ...pristine(), ...Object.fromEntries(written) };
}

/**
 * A copy of the fixtures in a temporary directory of its own, in a package
 * that resolves `hypotes` to this one, until the test that is running ends
 */
function project(files: Tree = pristine()): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'hypotes-snapshots-')));
    onTestFinished(() => {
        rmSync(root, { recursive: true, force: true });
    });

    writeFileSync(join(root, 'package.json'), '{ "type": "module" }');
    mkdirSync(join(root, 'node_modules'));
    // A junction needs no privilege on Windows
    symlinkSync(ROOT, join(root, 'node_modules', 'hypotes'), 'junction');

    const tests = join(root, 'tests');
    cpSync(FIXTURES, tests, { recursive: true });
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(tests, path, '..'), { recursive: true });
        writeFileSync(join(tests, path), content);
    }

    return tests;
}

interface RunOptions {
    /** The variables that the run adds to the environment */
    readonly env?: Readonly<Record<string, string>>;
    /** The flags of Node that the run adds */
    readonly flags?: readonly string[];
}

interface Run {
    readonly code: number | null;
    /** What node:test's `spec` reporter printed */
    readonly output: string;
    /** The names of the tests that failed, and of the files that did */
    readonly failed: string[];
    /** The diagnostics of the run that tell of snapshots */
    readonly diagnostics: string[];
}

/** The lines of a report that start with the mark, without it */
function marked(report: string, mark: string): string[] {
    const lines = report.split('\n').map(line => line.trim());

    return lines
        .filter(line => line.startsWith(`${mark} `))
        .map(line => line.slice(mark.length + 1));
}

/**
 * A run of test files of a project with node:test, in another process, as
 * outside a CI, whatever this run is in
 */
async function run(
    tests: string,
    files: readonly string[],
    { env = {}, flags = [] }: RunOptions = {}
): Promise<Run> {
    const base = { ...process.env };
    // Which tells node:test that it runs in a test file's process
    delete base['NODE_TEST_CONTEXT'];
    delete base['FORCE_COLOR'];
    delete base['CI'];
    delete base['UPDATE_SNAPSHOT'];

    const args = [
        ...flags,
        '--import',
        'hypotes/register',
        '--test',
        '--test-reporter=spec',
        ...files
    ];
    const child = spawn(process.execPath, args, { cwd: tests, env: { ...base, ...env } });
    const [stdout, stderr, [code]] = await Promise.all([
        text(child.stdout),
        text(child.stderr),
        once(child, 'exit') as Promise<[number | null]>
    ]);

    // The report ends with the failures again, after the totals
    const [results = ''] = stdout.split('\nℹ tests ');
    const failed = marked(results, '✖').map(line => line.replace(/ \([\d.]+ms\)$/, ''));
    const diagnostics = marked(results, 'ℹ').filter(line => /snapshots? of/.test(line));

    return { code, output: stdout + stderr, failed, diagnostics };
}

/** The files of a project that differ from those of a tree, or are missing from one */
function changed(tests: string, from: Tree): string[] {
    const now = treeOf(tests);
    const paths = new Set([...Object.keys(now), ...Object.keys(from)]);

    return Array.from(paths)
        .filter(path => now[path] !== from[path])
        .sort();
}

describe('snapshots', () => {
    it('should write what Vitest writes, to the byte', async () => {
        const tests = project();

        const { failed, diagnostics } = await run(tests, TEST_FILES);

        expect(treeOf(tests)).toStrictEqual(writtenByVitest());
        expect(failed).toStrictEqual(FAILING);
        expect(diagnostics).toStrictEqual([
            'snapshots of basic.ts: 52 written',
            'snapshots of changes.ts: 7 written',
            'snapshots of concurrent.ts: 11 written',
            'snapshots of file.ts: 6 written',
            'snapshots of inline.ts: 20 written',
            'snapshots of misuse.ts: 7 written',
            'snapshots of mocked.ts: 4 written'
        ]);
    });

    it("should pass on what Vitest wrote, and leave it as it is, in a CI's run", async () => {
        const written = writtenByVitest();
        const tests = project(written);

        const { failed, diagnostics } = await run(tests, TEST_FILES, { env: { CI: 'true' } });

        expect(failed).toStrictEqual(FAILING);
        expect(changed(tests, written)).toStrictEqual([]);
        expect(diagnostics).toStrictEqual([]);
    });

    it('should write the same in one process as in a process for each file', async () => {
        const tests = project();

        const { failed } = await run(tests, TEST_FILES, { flags: ['--test-isolation=none'] });

        expect(treeOf(tests)).toStrictEqual(writtenByVitest());
        expect(failed).toStrictEqual(FAILING);
    });
});

describe('a snapshot that differs', () => {
    const CHANGED = { SNAPSHOT_VALUE: 'second' };
    /** What a changed value changes, each kind of snapshot of it */
    const UPDATED = ['__snapshots__/changes.ts.snap', 'changes.ts', 'golden/changes.txt'];

    it('should fail the test, with the lines that differ, and keep the snapshot', async () => {
        const written = writtenByVitest();
        const tests = project(written);

        const { code, failed, output } = await run(tests, ['changes.ts'], { env: CHANGED });

        expect(code).toBe(1);
        expect(failed).toStrictEqual(['external', 'inline', 'file']);
        expect(output).toContain(
            [
                '  Error: Snapshot `external 1` mismatched',
                '  ',
                '  + actual - expected',
                '  ',
                '    {',
                '      "lines": "one',
                '    two",',
                '  +   "value": "second",',
                '  -   "value": "first",',
                '    }'
            ].join('\n')
        );
        expect(output).toContain('Error: Snapshot `inline 1` mismatched');
        expect(output).toContain('Error: Snapshot `file 1` mismatched');
        expect(changed(tests, written)).toStrictEqual([]);
    });

    it.each([
        ['UPDATE_SNAPSHOT is all', { env: { ...CHANGED, UPDATE_SNAPSHOT: 'all' } }],
        ['UPDATE_SNAPSHOT is set', { env: { ...CHANGED, UPDATE_SNAPSHOT: '1' } }],
        ["node:test's flag is passed", { env: CHANGED, flags: ['--test-update-snapshots'] }],
        ['a CI updates', { env: { ...CHANGED, CI: 'true', UPDATE_SNAPSHOT: 'all' } }]
    ])('should be written where %s', async (_, options) => {
        const written = writtenByVitest();
        const tests = project(written);

        const { code, diagnostics } = await run(tests, ['changes.ts'], options);

        expect(code).toBe(0);
        expect(diagnostics).toStrictEqual(['snapshots of changes.ts: 3 updated']);
        expect(changed(tests, written)).toStrictEqual(UPDATED);
        expect(treeOf(tests)).toMatchObject({
            '__snapshots__/changes.ts.snap': expect.stringContaining('"value": "second"'),
            'changes.ts': expect.stringContaining('toMatchInlineSnapshot(`"second"`)'),
            'golden/changes.txt': 'second\n'
        });
    });

    it('should fail where UPDATE_SNAPSHOT is none', async () => {
        const written = writtenByVitest();
        const tests = project(written);

        const { failed } = await run(tests, ['changes.ts'], {
            env: { ...CHANGED, UPDATE_SNAPSHOT: 'none' },
            flags: ['--test-update-snapshots']
        });

        expect(failed).toStrictEqual(['external', 'inline', 'file']);
        expect(changed(tests, written)).toStrictEqual([]);
    });
});

describe('a snapshot that is missing', () => {
    /** The tests of `changes.ts`, each of which has a snapshot to write */
    const TESTS = [
        'external',
        'inline',
        'file',
        'named',
        'skippable',
        'in a suite',
        'inner',
        'skippable suite'
    ];

    it("should fail the test in a CI's run, and not be written", async () => {
        const tests = project();

        const { failed, output } = await run(tests, ['changes.ts'], { env: { CI: 'true' } });

        expect(failed).toStrictEqual(TESTS);
        expect(output).toContain(
            [
                '  Error: Snapshot `named 1` mismatched',
                '  ',
                '  + actual - expected',
                '  ',
                '  + "named"'
            ].join('\n')
        );
        expect(changed(tests, pristine())).toStrictEqual([]);
    });

    it("should be written in a CI's run where UPDATE_SNAPSHOT is new", async () => {
        const tests = project();

        const { failed } = await run(tests, ['changes.ts'], {
            env: { CI: 'true', UPDATE_SNAPSHOT: 'new' }
        });

        expect(failed).toStrictEqual([]);
        expect(treeOf(tests)).toMatchObject({
            '__snapshots__/changes.ts.snap': writtenByVitest()['__snapshots__/changes.ts.snap']
        });
    });
});

describe('a snapshot that no test asks for', () => {
    const RENAMED = { SNAPSHOT_NAME: 'renamed' };
    const SNAPSHOTS = '__snapshots__/changes.ts.snap';

    it('should be reported, and kept, where only new snapshots are written', async () => {
        const tests = project(writtenByVitest());

        const { code, diagnostics } = await run(tests, ['changes.ts'], { env: RENAMED });

        expect(code).toBe(0);
        expect(diagnostics).toStrictEqual([
            'snapshots of changes.ts: 1 written, 1 obsolete',
            'obsolete snapshot of changes.ts: named 1'
        ]);
        expect(treeOf(tests)[SNAPSHOTS]).toContain('exports[`named 1`]');
        expect(treeOf(tests)[SNAPSHOTS]).toContain('exports[`renamed 1`]');
    });

    it("should fail the test file in a CI's run, with Vitest's error", async () => {
        const written = writtenByVitest();
        const tests = project(written);

        const { failed, output } = await run(tests, ['changes.ts'], {
            env: { ...RENAMED, CI: 'true' }
        });

        // node:test names a hook that fails by its file
        expect(failed).toStrictEqual(['renamed', expect.stringMatching(/changes\.ts$/)]);
        expect(output).toContain(
            'Error: Obsolete snapshots found when no snapshot update is expected.\n  · named 1\n'
        );
        expect(changed(tests, written)).toStrictEqual([]);
    });

    it('should be removed where snapshots are updated', async () => {
        const tests = project(writtenByVitest());

        const { code, diagnostics } = await run(tests, ['changes.ts'], {
            env: { ...RENAMED, UPDATE_SNAPSHOT: 'all' }
        });

        expect(code).toBe(0);
        expect(diagnostics).toStrictEqual(['snapshots of changes.ts: 1 written, 1 removed']);
        expect(treeOf(tests)[SNAPSHOTS]).not.toContain('exports[`named 1`]');
        expect(treeOf(tests)[SNAPSHOTS]).toContain('exports[`renamed 1`]');
    });

    it.each<[string, RunOptions]>([
        ['is skipped, or in a skipped suite', { env: { SNAPSHOT_SKIPS: '1' } }],
        ['is left out by a pattern of names', { flags: ['--test-name-pattern=external'] }]
    ])('should be kept by an update if its test %s', async (_, options) => {
        const written = writtenByVitest();
        const tests = project(written);

        const { code, diagnostics } = await run(tests, ['changes.ts'], {
            ...options,
            env: { ...options.env, UPDATE_SNAPSHOT: 'all' }
        });

        expect(code).toBe(0);
        expect(diagnostics).toStrictEqual([]);
        expect(changed(tests, written)).toStrictEqual([]);
    });

    it("should pass a CI's run if its test is skipped", async () => {
        const tests = project(writtenByVitest());

        const { code } = await run(tests, ['changes.ts'], {
            env: { SNAPSHOT_SKIPS: '1', CI: 'true' }
        });

        expect(code).toBe(0);
    });
});
