// What a run reports to GitHub Actions, as Vitest's `github-actions`
// reporter does: a workflow command for each failure, which GitHub shows as
// an annotation on the line of the pull request's diff, and a summary of the
// job, appended to the file that `GITHUB_STEP_SUMMARY` names.
//
// Where it differs from Vitest 5.1's:
//
// - A command names its column as `col`, which is the property that
//   GitHub's runner reads. Vitest writes `column`, which the runner
//   ignores, so its annotations have a line only.
// - The summary is titled `hypotes Test Report`, and has no flaky tests,
//   nor tests expected to fail: node:test retries none, and has no
//   `it.fails`.
// - It takes no options. Vitest's `onWritePath`, `displayAnnotations` and
//   `jobSummary` are options of its reporter, and node:test passes a
//   reporter none. The variables that GitHub sets are the only switch.
//
// A command's file is an absolute path, as Vitest's is: the runner makes a
// path inside the workspace relative to the repository itself.
import { appendFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { Position } from './stack.ts';

/** A failure, at the position in a file that GitHub shows it on */
export interface Annotation {
    /** The file's absolute path */
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly title: string;
    readonly message: string;
}

/** How many files or tests had each result */
export interface Stats {
    readonly failed: number;
    readonly passed: number;
    readonly skipped: number;
    readonly todo: number;
}

const SUMMARY_TITLE = 'hypotes Test Report';
const SEPARATOR = ' · ';

/**
 * A command's message, escaped as GitHub's toolkit does: the runner reads a
 * command to the end of its line, and unescapes these
 */
function escapeData(text: string): string {
    return text
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
}

/** A property's value, in which a colon or a comma would end it */
function escapeProperty(text: string): string {
    return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

/**
 * The workflow command of an error, as
 * `::error file=…,title=…,line=…,col=…::message`, with its properties in
 * the order of Vitest's
 */
export function formatErrorCommand({
    file,
    line,
    column,
    title,
    message
}: Annotation): string {
    const properties = [
        `file=${escapeProperty(file)}`,
        `title=${escapeProperty(title)}`,
        `line=${line}`,
        `col=${column}`
    ];

    return `::error ${properties.join(',')}::${escapeData(stripVTControlCharacters(message))}`;
}

function noun(count: number, singular: string, plural: string): string {
    return count === 1 ? singular : plural;
}

/** The counts of failures and passes, as Vitest's summary words them */
function formatResults({ failed, passed }: Stats): string {
    const parts: string[] = [];

    if (failed > 0) {
        parts.push(`❌ **${failed} ${noun(failed, 'failure', 'failures')}**`);
    }
    if (passed > 0) {
        parts.push(`✅ **${passed} ${noun(passed, 'pass', 'passes')}**`);
    }
    parts.push(`${failed + passed} total`);

    return parts.join(SEPARATOR);
}

/**
 * The summary of a run in Markdown, in the format of Vitest's: the files
 * and the tests that failed and passed, and the tests that were skipped or
 * are to do, if any
 */
export function formatJobSummary(files: Stats, tests: Stats): string {
    const { skipped, todo } = tests;
    const other: string[] = [];

    if (skipped > 0) {
        other.push(`${skipped} ${noun(skipped, 'skip', 'skips')}`);
    }
    if (todo > 0) {
        other.push(`${todo} ${noun(todo, 'todo', 'todos')}`);
    }

    let summary =
        `## ${SUMMARY_TITLE}\n\n### Summary\n\n` +
        `- **Test Files**: ${formatResults(files)}\n` +
        `- **Test Results**: ${formatResults(tests)}\n`;

    if (other.length > 0) {
        other.push(`${skipped + todo} total`);
        summary += `- **Other**: ${other.join(SEPARATOR)}\n`;
    }

    return summary;
}

/** A job of GitHub Actions that the run is a step of */
export class GitHubActions {
    readonly #summaryPath: string | undefined;
    readonly #workspace: string | undefined;

    private constructor(env: NodeJS.ProcessEnv) {
        this.#summaryPath = env.GITHUB_STEP_SUMMARY;
        this.#workspace = env.GITHUB_WORKSPACE;
    }

    /**
     * The job that the environment's variables say the run is in, if any:
     * GitHub sets `GITHUB_ACTIONS` to `true`, which is when Vitest adds its
     * reporter
     */
    static from(env: NodeJS.ProcessEnv): GitHubActions | undefined {
        return env.GITHUB_ACTIONS === 'true'
            ? new GitHubActions(env)
            : undefined;
    }

    /** The first frame the runner can attach to the checkout, or the declaration */
    position(frames: readonly Position[], declared: Position): Position {
        const workspace = this.#workspace;
        if (!workspace) {
            return frames[0] ?? declared;
        }

        const frame = frames.find(({ file }) => {
            const path = relative(workspace, file);
            // On Windows, a path on another drive stays absolute.
            return (
                isAbsolute(file) &&
                !isAbsolute(path) &&
                path !== '..' &&
                !path.startsWith(`..${sep}`)
            );
        });

        return frame ?? declared;
    }

    /**
     * Appends a run's summary to the job's, where GitHub names a file for
     * it. Gives what to print: nothing, or why the file couldn't be written,
     * which doesn't fail the run.
     */
    summarize(files: Stats, tests: Stats): string {
        // GitHub may set the variable to nothing, which names no file
        if (!this.#summaryPath) {
            return '';
        }

        try {
            appendFileSync(this.#summaryPath, formatJobSummary(files, tests));
        } catch (error) {
            return `Could not write the job summary to ${this.#summaryPath}: ${String(error)}\n`;
        }

        return '';
    }
}
