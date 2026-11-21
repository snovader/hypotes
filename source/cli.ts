#!/usr/bin/env node
// The `hypotes` command, a launcher of `node --test`, which stays the
// runner:
//
//     hypotes [--project <name>]... [node's flags] [files or patterns]
//
// It runs Node with the preload `hypotes/register` and the reporter
// `hypotes/reporter`, and passes the rest of its arguments on, so node:test's
// flags, such as `--watch` and `--test-name-pattern`, work as they do there.
//
// It has three of Vitest's defaults where node:test's differ, each of which
// an argument replaces. Named no files, node:test runs every file in a
// `test` directory, the helpers there too, so the command names Vitest's
// pattern of test files to it. node:test's tests have no timeout, so the
// command passes Vitest's, as `--test-timeout`, which node:test gives to
// hooks as well. And node:test waits for what a test leaves running, a
// timer or a server, where Vitest ends a file's worker after its tests, so
// the command passes `--test-force-exit`: without it, a test that has
// timed out still holds the run. Node refuses the flag with `--watch`, so
// the command leaves it out then, and a `--no-test-force-exit` after it
// turns it off, as Node reads the later of the two.
//
// `--project` is the one flag of its own, after Vitest's. node:test can't
// select files by their package, so with `--project` this names the
// selected projects' directories or files to node:test, as `test-files.ts`
// says.
//
// It tells patterns from flags by the leading `-`: a flag's value has to
// follow a `=`, as in `--test-name-pattern=adds`, or it's taken for a
// pattern. Node gets the flags first, then a `--`, then the patterns, so
// that it reads them the same way: it fails a flag that is left without
// its value, rather than take a pattern for it. Without the `--`, Node
// would take `adds` for the flag's value while the command took it for a
// pattern, and left out the default.
import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import { ProjectFilter } from './project-filter.ts';
import { DEFAULT_PATTERN, TestFiles } from './test-files.ts';

const USAGE = `Usage: hypotes [--project <name>]... [node's flags] [files or patterns]

Runs tests with node --test, with the preload hypotes/register and the
reporter hypotes/reporter. Other flags are node's, such as --watch,
--test-name-pattern=<pattern> and --test-reporter=<reporter>. A flag's value
follows a =, or it's taken for a pattern of files, and node fails the flag.

Without files or patterns, it runs the files that match
${DEFAULT_PATTERN}
and without --test-timeout, a test or a hook fails after 5 seconds. It ends
each file once its tests are done, whatever they left running, unless it's
given --no-test-force-exit or --watch.

  --project <name>  Runs only the test files of the package with the name in
                    its package.json. Can be repeated. A * matches any
                    characters, and a leading ! leaves projects out.
  -h, --help        Prints this.
`;

/** Node's exit code for an invalid argument */
const INVALID_ARGUMENT = 9;

/** Vitest's default `testTimeout`, in milliseconds */
const DEFAULT_TIMEOUT = 5000;

/** The argument after which Node takes each one for a file, not a flag */
const SEPARATOR = '--';

/** The signals that end a process, which the launcher passes on to Node */
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** An error in how the command was called, which it prints without a stack */
class UsageError extends Error {
    readonly #exitCode: number;

    constructor(message: string, exitCode: number) {
        super(message);
        this.#exitCode = exitCode;
    }

    exitCode(): number {
        return this.#exitCode;
    }
}

interface Arguments {
    /** The patterns of each `--project` */
    readonly projects: readonly string[];
    /** The other arguments, in order, which are node's */
    readonly rest: readonly string[];
    readonly help: boolean;
}

function parseArguments(args: readonly string[]): Arguments {
    const projects: string[] = [];
    const rest: string[] = [];
    let help = false;

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];

        if (argument === '--project') {
            index++;
            if (index === args.length) {
                throw new UsageError(
                    '--project needs the name of a project',
                    INVALID_ARGUMENT
                );
            }
            projects.push(args[index]);
        } else if (argument.startsWith('--project=')) {
            projects.push(argument.slice('--project='.length));
        } else if (argument === '--help' || argument === '-h') {
            help = true;
        } else {
            rest.push(argument);
        }
    }

    return { projects, rest, help };
}

/** Whether an argument names files, rather than being one of node's flags */
function isPattern(argument: string): boolean {
    return !argument.startsWith('-');
}

/** Whether the arguments have the flag, with a value or without */
function hasFlag(args: readonly string[], flag: string): boolean {
    return args.some(
        argument => argument === flag || argument.startsWith(`${flag}=`)
    );
}

interface Separated {
    /** Node's flags, in order */
    readonly flags: readonly string[];
    /** The files and patterns of files, in order */
    readonly patterns: readonly string[];
}

/**
 * Node's flags among the arguments, apart from what names files: the
 * arguments without a leading `-`, and each one after a `--`, as in Node
 */
function separate(rest: readonly string[]): Separated {
    const end = rest.indexOf(SEPARATOR);
    const before = end === -1 ? rest : rest.slice(0, end);
    const after = end === -1 ? [] : rest.slice(end + 1);

    return {
        flags: before.filter(argument => !isPattern(argument)),
        patterns: [...before.filter(isPattern), ...after]
    };
}

/**
 * What names the test files of the selected projects, in place of the
 * patterns
 */
function selectFiles(
    projects: readonly string[],
    patterns: readonly string[],
    cwd: string
): readonly string[] {
    const testFiles = new TestFiles(cwd, new ProjectFilter(projects));
    const named =
        patterns.length === 0
            ? testFiles.ofProjects(DEFAULT_PATTERN)
            : testFiles.matching(patterns);

    if (named.length === 0) {
        // Rather than have node:test look for every test file, as it does
        // when it's named none
        const known = testFiles.projectNames().join(', ');

        throw new UsageError(
            `found no test files of --project ${projects.join(', ')}, among the projects ${known}`,
            1
        );
    }

    return named;
}

/** The files and patterns that Node runs: the default pattern, if none is named */
function filesToRun(
    projects: readonly string[],
    patterns: readonly string[],
    cwd: string
): readonly string[] {
    if (projects.length > 0) {
        return selectFiles(projects, patterns, cwd);
    }

    return patterns.length === 0 ? [DEFAULT_PATTERN] : patterns;
}

/**
 * The arguments that Node runs the tests with: the flags, then the files
 * after a `--`, as the header says
 */
function nodeArguments({ projects, rest }: Arguments, cwd: string): string[] {
    const { flags, patterns } = separate(rest);
    const files = filesToRun(projects, patterns, cwd);

    return [
        '--import',
        import.meta.resolve('hypotes/register'),
        '--test',
        ...(hasFlag(flags, '--test-reporter')
            ? []
            : [`--test-reporter=${import.meta.resolve('hypotes/reporter')}`]),
        ...(hasFlag(flags, '--test-timeout')
            ? []
            : [`--test-timeout=${DEFAULT_TIMEOUT}`]),
        ...(hasFlag(flags, '--watch') ? [] : ['--test-force-exit']),
        ...flags,
        SEPARATOR,
        ...files
    ];
}

/**
 * Ends this process as Node ended: with its exit code, or by its signal.
 * Node gets the signals that this process does, or it would outlive a
 * launcher that another process ends, as it would under `--watch`.
 */
function follow(node: ChildProcess): void {
    const forwards = SIGNALS.map(signal => {
        const forward = (): void => {
            node.kill(signal);
        };
        process.on(signal, forward);

        return { signal, forward };
    });

    node.on('exit', (code, signal) => {
        for (const { signal: forwarded, forward } of forwards) {
            process.off(forwarded, forward);
        }

        if (signal == null) {
            process.exitCode = code ?? 1;
        } else {
            process.kill(process.pid, signal);
        }
    });
}

function startFailure(error: unknown, args: readonly string[]): string {
    const code = (error as { code?: unknown }).code;

    return code === 'E2BIG' || code === 'ENAMETOOLONG'
        ? `the command that names the test files to Node is too long, with ${args.length} arguments. Select fewer files with --project or a pattern.`
        : `couldn't start Node: ${String(error)}`;
}

/**
 * Starts Node. A command can only be so long, which the test files of a
 * project that are named one by one can exceed: the system then refuses to
 * start it.
 */
function start(args: readonly string[]): ChildProcess {
    try {
        return spawn(process.execPath, args, { stdio: 'inherit' }).on(
            'error',
            error => {
                process.stderr.write(`hypotes: ${startFailure(error, args)}\n`);
                process.exitCode = 1;
            }
        );
    } catch (error) {
        throw new UsageError(startFailure(error, args), 1);
    }
}

function main(): void {
    const parsed = parseArguments(process.argv.slice(2));

    if (parsed.help) {
        process.stdout.write(USAGE);
        return;
    }

    follow(start(nodeArguments(parsed, process.cwd())));
}

try {
    main();
} catch (error) {
    if (!(error instanceof UsageError)) {
        throw error;
    }

    process.stderr.write(`hypotes: ${error.message}\n`);
    process.exitCode = error.exitCode();
}
