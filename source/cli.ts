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
// select files by their package, so with `--project` this finds the test
// files, as `test-files.ts` says, and names those of the selected projects
// to node:test. It then has to tell patterns from flags, which it does by
// the leading `-`: a flag's value has to follow a `=`, as in
// `--test-name-pattern=adds`, or it's taken for a pattern.
import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import { ProjectFilter } from './project-filter.ts';
import { defaultPattern, findProjectFiles } from './test-files.ts';

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
 * Node's flags among the arguments, and the test files of the selected
 * projects in place of the patterns
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
    const files = findProjectFiles(
        patterns.length === 0 ? [defaultPattern(stripsTypes)] : patterns,
        new ProjectFilter(projects),
        cwd
    );

    if (files.length === 0) {
        // As node:test exits when it finds no file of a pattern
        throw new UsageError(
            `found no test files of --project ${projects.join(', ')}`,
            1
        );
    }

    return [...flags, ...files];
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

function main(): void {
    const parsed = parseArguments(process.argv.slice(2));

    if (parsed.help) {
        process.stdout.write(USAGE);
        return;
    }

    const node = spawn(process.execPath, nodeArguments(parsed, process.cwd()), {
        stdio: 'inherit'
    });
    follow(node);
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
