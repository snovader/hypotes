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
// `--project` is the one flag of its own, after Vitest's. node:test can't
// select files by their package, so with `--project` this names the
// selected projects' directories or files to node:test, as `test-files.ts`
// says. It then has to tell patterns from flags, which it does by the
// leading `-`: a flag's value has to follow a `=`, as in
// `--test-name-pattern=adds`, or it's taken for a pattern.
import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import { ProjectFilter } from './project-filter.ts';
import { defaultPattern, TestFiles } from './test-files.ts';

const USAGE = `Usage: hypotes [--project <name>]... [node's flags] [files or patterns]

Runs tests with node --test, with the preload hypotes/register and the
reporter hypotes/reporter. Other flags are node's, such as --watch,
--test-name-pattern=<pattern> and --test-reporter=<reporter>.

  --project <name>  Runs only the test files of the package with the name in
                    its package.json. Can be repeated. A * matches any
                    characters, and a leading ! leaves projects out.
  -h, --help        Prints this.
`;

/** Node's exit code for an invalid argument */
const INVALID_ARGUMENT = 9;

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

/**
 * Node's flags among the arguments, and what names the test files of the
 * selected projects in place of the patterns
 */
function selectFiles(
    projects: readonly string[],
    rest: readonly string[],
    cwd: string
): string[] {
    const flags = rest.filter(argument => argument.startsWith('-'));
    const patterns = rest.filter(argument => !argument.startsWith('-'));

    const stripsTypes = !flags.some(flag =>
        /^--no-(?:experimental-)?strip-types$/u.test(flag)
    );
    const testFiles = new TestFiles(cwd, new ProjectFilter(projects));
    const named =
        patterns.length === 0
            ? testFiles.ofProjects(defaultPattern(stripsTypes))
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

    return [...flags, ...named];
}

/** The arguments that Node runs the tests with */
function nodeArguments({ projects, rest }: Arguments, cwd: string): string[] {
    const passed =
        projects.length === 0 ? rest : selectFiles(projects, rest, cwd);
    const hasReporter = rest.some(argument =>
        /^--test-reporter(?:=|$)/u.test(argument)
    );

    return [
        '--import',
        import.meta.resolve('hypotes/register'),
        '--test',
        ...(hasReporter
            ? []
            : [`--test-reporter=${import.meta.resolve('hypotes/reporter')}`]),
        ...passed
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

        if (signal === null) {
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
