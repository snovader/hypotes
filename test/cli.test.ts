import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'hypotes';

const CLI = fileURLToPath(import.meta.resolve('hypotes/cli'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * The packages `@fixture/alpha`, `beta`, with `@fixture/lib` inside it, and
 * `bracket`, in a directory whose name means something in a glob pattern
 */
const PROJECTS = fileURLToPath(new URL('fixtures/projects', import.meta.url));
const ALPHA = fileURLToPath(new URL('fixtures/projects/alpha', import.meta.url));

/** The environment of a run whose output goes to a pipe, without colours */
function environment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // Which tells node:test that it runs in a test file's process
    delete env.NODE_TEST_CONTEXT;
    delete env.FORCE_COLOR;
    // With which the reporter would report the fixtures' failures to the
    // job of GitHub Actions that these tests run in
    delete env.GITHUB_ACTIONS;

    return env;
}

interface Run {
    readonly stdout: string;
    readonly stderr: string;
    readonly code: number | null;
}

/** A run of the command in the directory, in another process */
async function hypotes(args: readonly string[], cwd = PROJECTS): Promise<Run> {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: environment() });
    const [stdout, stderr, [code]] = await Promise.all([
        text(child.stdout),
        text(child.stderr),
        once(child, 'exit') as Promise<[number | null]>
    ]);

    return { stdout, stderr, code };
}

/** The files that a report has rows of, with their projects */
function files(report: string): string[] {
    return Array.from(report.matchAll(/^ [✓❯] (\S+ \S+) \(/gm), match => match[1]);
}

describe('hypotes', () => {
    it("should run the files of Vitest's pattern when it is named none", async () => {
        // And not `test/helper.ts`, which node:test would run
        const { stdout, code } = await hypotes([], ALPHA);

        expect(files(stdout)).toStrictEqual([
            '|@fixture/alpha| test/mixed.spec.ts',
            '|@fixture/alpha| test/nested/deep.spec.ts',
            '|@fixture/alpha| test/passes.spec.ts'
        ]);
        expect(code).toBe(1);
    });

    it('should run only the files that it is named', async () => {
        const { stdout, code } = await hypotes(['test/passes.spec.ts'], ALPHA);

        expect(files(stdout)).toStrictEqual(['|@fixture/alpha| test/passes.spec.ts']);
        expect(code).toBe(0);
    });

    it('should name the pattern after flags alone', async () => {
        const { stdout } = await hypotes(['--test-name-pattern=adds'], ALPHA);

        expect(files(stdout)).toStrictEqual([
            '|@fixture/alpha| test/mixed.spec.ts',
            '|@fixture/alpha| test/nested/deep.spec.ts',
            '|@fixture/alpha| test/passes.spec.ts'
        ]);
        expect(stdout).toContain('      Tests  1 passed (1)\n');
    });

    it('should take each argument after -- for a file', async () => {
        const { stdout, code } = await hypotes(['--test-only', '--', 'test/passes.spec.ts'], ALPHA);

        expect(files(stdout)).toStrictEqual(['|@fixture/alpha| test/passes.spec.ts']);
        expect(code).toBe(0);
    });

    it('should have Node fail a flag whose value does not follow a =', async () => {
        // Rather than take `adds` for a pattern, and leave out the default,
        // while Node takes it for the flag's value
        const [alone, ofProject] = await Promise.all([
            hypotes(['--test-name-pattern', 'adds'], ALPHA),
            hypotes(['--project', '@fixture/alpha', '--test-name-pattern', 'adds'])
        ]);

        expect(alone.stderr).toContain('--test-name-pattern requires an argument');
        expect(alone.stdout).toBe('');
        expect(alone.code).toBe(9);
        expect(ofProject.code).not.toBe(0);
        expect(files(ofProject.stdout)).toStrictEqual([]);
    });

    it("should fail a test that outlasts Vitest's timeout of 5 seconds", async () => {
        const { stdout, code } = await hypotes(['beta/outlasts.ts']);

        expect(stdout).toContain(
            ' FAIL |beta| outlasts.ts > outlasts the timeout\ntest timed out after 5000ms\n'
        );
        expect(code).toBe(1);
    });

    it('should leave the timeout to --test-timeout, of a hook too', async () => {
        const [short, long] = await Promise.all([
            hypotes(['--test-timeout=100', 'beta/slow.ts']),
            hypotes(['--test-timeout=10000', 'beta/outlasts.ts'])
        ]);

        expect(short.stdout).toContain(
            ' FAIL |beta| slow.ts > with a slow hook\ntest timed out after 100ms\n'
        );
        expect(short.stdout).toContain(
            ' FAIL |beta| slow.ts > is slow\ntest timed out after 100ms\n'
        );
        expect(long.code).toBe(0);
    });

    it('should end a file whose test leaves a timer running', async () => {
        // The timer writes as it runs, a second after the test has passed
        const { stdout, code } = await hypotes(['beta/leaves.ts']);

        expect(stdout).not.toContain('the timer ran');
        expect(code).toBe(0);
    });

    it('should wait for what a test leaves running with --no-test-force-exit', async () => {
        const { stdout, code } = await hypotes(['--no-test-force-exit', 'beta/leaves.ts']);

        expect(stdout).toContain('the timer ran\n');
        expect(code).toBe(0);
    });

    it("should run a project's test files, which Vitest's pattern finds", async () => {
        const { stdout, code } = await hypotes(['--project', '@fixture/alpha']);

        expect(files(stdout)).toStrictEqual([
            '|@fixture/alpha| test/mixed.spec.ts',
            '|@fixture/alpha| test/nested/deep.spec.ts',
            '|@fixture/alpha| test/passes.spec.ts'
        ]);
        expect(code).toBe(1);
    });

    it("should run a project's files among those of the patterns", async () => {
        // Which match a file of another project too, `in-bracket.spec.ts`
        const { stdout } = await hypotes(['--project=beta', '**/{broken,hook,in-*}.ts']);

        expect(files(stdout)).toStrictEqual([
            '|beta| broken.ts',
            '|beta| hook.ts',
            '|beta| test/in-beta.spec.ts'
        ]);
    });

    it('should run only the files of a project that has another inside it', async () => {
        const { stdout, code } = await hypotes(['--project', 'beta']);

        expect(files(stdout)).toStrictEqual(['|beta| test/in-beta.spec.ts']);
        expect(code).toBe(0);
    });

    it('should run the files of each selected project, one inside another too', async () => {
        const { stdout } = await hypotes(['--project', '*', '--project', '!@fixture/alpha']);

        expect(files(stdout)).toStrictEqual([
            '|bracket| test/in-bracket.spec.ts',
            '|beta| test/in-beta.spec.ts'
        ]);
    });

    it('should run a project in a directory whose name reads as a glob pattern', async () => {
        const [byDefault, byPattern] = await Promise.all([
            hypotes(['--project', 'bracket']),
            hypotes(['--project', 'bracket', '**/in-*.ts'])
        ]);

        expect(files(byDefault.stdout)).toStrictEqual(['|bracket| test/in-bracket.spec.ts']);
        expect(files(byPattern.stdout)).toStrictEqual(['|bracket| test/in-bracket.spec.ts']);
    });

    it('should take * in the name of a project, and leave out one after !', async () => {
        const { stdout } = await hypotes([
            '--project',
            '@fixture/*',
            '--project',
            '!@fixture/alpha',
            '**/*.ts'
        ]);

        expect(files(stdout)).toStrictEqual(['|@fixture/lib| declare.ts']);
    });

    it("should pass node:test's flags on", async () => {
        const { stdout, code } = await hypotes([
            '--project',
            '@fixture/alpha',
            '--test-name-pattern=adds'
        ]);

        expect(stdout).toContain('      Tests  1 passed (1)\n');
        expect(code).toBe(0);
    });

    it('should leave the reporter to --test-reporter', async () => {
        const { stdout } = await hypotes([
            '--project',
            '@fixture/alpha',
            '--test-reporter=tap',
            'alpha/test/passes.spec.ts'
        ]);

        expect(stdout).toContain('TAP version 13');
        expect(stdout).not.toContain('|@fixture/alpha|');
    });

    it('should exit with 0 when the tests pass', async () => {
        const { code } = await hypotes([
            '--project',
            '@fixture/alpha',
            'alpha/test/passes.spec.ts'
        ]);

        expect(code).toBe(0);
    });

    it('should fail when no test file is of the projects', async () => {
        const { stdout, stderr, code } = await hypotes(['--project', 'gamma']);

        expect(stdout).toBe('');
        expect(stderr).toBe(
            'hypotes: found no test files of --project gamma, among the projects ' +
                '@fixture/alpha, @fixture/lib, beta, bracket, hypotes\n'
        );
        expect(code).toBe(1);
    });

    it('should fail when --project has no name', async () => {
        const { stderr, code } = await hypotes(['--project']);

        expect(stderr).toBe('hypotes: --project needs the name of a project\n');
        expect(code).toBe(9);
    });

    it('should print how it is used with --help, and run nothing', async () => {
        const { stdout, code } = await hypotes(['--help']);

        expect(stdout).toMatch(/^Usage: hypotes /);
        expect(code).toBe(0);
    });

    it('should leave the files to node:test without --project, and preload hypotes/register', async () => {
        // A file that mocks a module, which fails as it loads without the
        // preload, and has a test that fails on purpose with it
        const { stdout } = await hypotes(['test/fixtures/mocks.ts'], ROOT);

        expect(stdout).toContain(' ❯ |hypotes| test/fixtures/mocks.ts (2 tests | 1 failed)');
    });

    // Windows has no signals: ending a process there ends it at once
    it.skipIf(process.platform === 'win32')(
        'should end Node when it is ended, as under --watch',
        async () => {
            const child = spawn(
                process.execPath,
                [CLI, '--project', '@fixture/alpha', '--watch', 'alpha/test/passes.spec.ts'],
                { cwd: PROJECTS, env: environment() }
            );
            // The report of the first run, after which Node watches
            await once(child.stdout, 'data');
            child.kill('SIGTERM');

            // Node holds the pipe too, which ends only once both have ended:
            // if Node were left running, this would wait until the test
            // timed out
            await text(child.stdout);

            expect(child.stdout.readableEnded).toBe(true);
        }
    );
});
