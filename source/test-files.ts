// What `cli.ts` names to node:test for the projects that `--project`
// selects. node:test finds test files itself, but can't tell which package
// a file is in.
//
// So a selected project is named by a pattern of its directory, which
// node:test's default pattern follows: node:test then finds the files, new
// ones under `--watch` too, and the arguments don't grow with them. That
// holds while every package inside the directory is selected as well.
// Otherwise the pattern would take in the files of a package that isn't,
// and the project's files are named one by one, as they are with patterns
// of the caller's own. A command can only be so long, which a list of
// files can exceed: about a megabyte on macOS and Linux, and 32,767
// characters on Windows.
import { globSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { ProjectFilter } from './project-filter.ts';
import { Projects } from './project.ts';

/** The directories that node:test doesn't look for test files in */
const EXCLUDED = ['**/node_modules/**'];

/** The characters of a path that mean something else in a glob pattern */
const GLOB_SYNTAX = /[()*?[\]{}]/gu;

/**
 * A path as a glob pattern of itself, which node:test takes each of its
 * arguments for: `[id]` would otherwise be either letter. A character that
 * means something in a pattern goes in a class of its own, which no
 * platform's paths read otherwise, as they do a backslash. A leading `!`
 * would leave the pattern's files out. A name with a comma between braces
 * is still read as its alternatives.
 */
function escapeGlob(path: string): string {
    const escaped = path.replaceAll(sep, '/').replaceAll(GLOB_SYNTAX, '[$&]');

    return escaped.startsWith('!') ? `./${escaped}` : escaped;
}

/**
 * The pattern of the files that node:test runs when it's given none, which
 * its documentation lists. It takes TypeScript's extensions unless Node is
 * told not to strip types.
 */
export function defaultPattern(stripsTypes: boolean): string {
    const extensions = stripsTypes ? 'js,mjs,cjs,ts,mts,cts' : 'js,mjs,cjs';

    return `**/{test,test/**/*,test-*,*[._-]test}.{${extensions}}`;
}

/** A project as `--project` selects it under a working directory */
interface Scope {
    readonly name: string;
    /**
     * The project's directory from the working directory, with `/`, or
     * empty for the project that the working directory itself is in
     */
    readonly directory: string;
    /** The absolute path of the project's directory, which may be above the working directory */
    readonly root: string;
}

function isInside(directory: string, ancestor: string): boolean {
    return (
        directory !== ancestor &&
        (ancestor === '' || directory.startsWith(`${ancestor}/`))
    );
}

/** The test files of projects under a working directory */
export class TestFiles {
    readonly #cwd: string;
    readonly #filter: ProjectFilter;
    readonly #projects = new Projects();

    /** Of the projects that the filter selects, under `cwd` */
    constructor(cwd: string, filter: ProjectFilter) {
        this.#cwd = cwd;
        this.#filter = filter;
    }

    /**
     * The names of the projects under the working directory, and of the one
     * that it's in, in order
     */
    projectNames(): string[] {
        return [...new Set(this.#scopes().map(scope => scope.name))].toSorted();
    }

    /**
     * The files that match the glob patterns and are in a selected project,
     * as patterns of their paths from the working directory, in order. A
     * file that no package with a name is above is in no project.
     */
    matching(patterns: readonly string[]): string[] {
        return globSync([...patterns], { cwd: this.#cwd, exclude: EXCLUDED })
            .filter(file => {
                const project = this.#projects.of(resolve(this.#cwd, file));

                return (
                    project !== undefined && this.#filter.matches(project.name)
                );
            })
            .toSorted()
            .map(file => escapeGlob(file));
    }

    /**
     * What names the test files of the selected projects to node:test: a
     * pattern for a project's directory, or its files, as the header says.
     * Nothing, if no project is selected, or none of the listed has a test
     * file.
     */
    ofProjects(pattern: string): string[] {
        const scopes = this.#scopes();
        const selected = scopes.filter(scope =>
            this.#filter.matches(scope.name)
        );
        const whole = selected.filter(scope => this.#isWhole(scope, scopes));

        // A project's pattern takes in the projects inside its directory
        const patterns = whole
            .filter(
                scope =>
                    !whole.some(other =>
                        isInside(scope.directory, other.directory)
                    )
            )
            .map(({ directory }) =>
                directory === ''
                    ? pattern
                    : `${escapeGlob(directory)}/${pattern}`
            );
        const files = selected
            .filter(scope => !whole.includes(scope))
            .flatMap(scope => this.#filesOf(scope, pattern));

        return [...patterns, ...files];
    }

    /**
     * The project that the working directory is in, and those in the
     * directories under it
     */
    #scopes(): Scope[] {
        const scopes: Scope[] = [];
        const around = this.#projects.of(join(this.#cwd, 'package.json'));
        if (around !== undefined && around.directory !== this.#cwd) {
            scopes.push({
                name: around.name,
                directory: '',
                root: around.directory
            });
        }

        for (const file of globSync('**/package.json', {
            cwd: this.#cwd,
            exclude: EXCLUDED
        })) {
            const directory = resolve(this.#cwd, dirname(file));
            const project = this.#projects.of(join(directory, 'package.json'));

            // Unless the package.json has no name, and the project is above it
            if (project?.directory === directory) {
                const path = dirname(file).replaceAll(sep, '/');
                scopes.push({
                    name: project.name,
                    directory: path === '.' ? '' : path,
                    root: directory
                });
            }
        }

        return scopes;
    }

    /**
     * Whether a pattern of the project's directory names its files, and no
     * others: each project inside it is selected too
     */
    #isWhole({ directory }: Scope, scopes: readonly Scope[]): boolean {
        return scopes
            .filter(scope => isInside(scope.directory, directory))
            .every(scope => this.#filter.matches(scope.name));
    }

    /** The project's own files that match the pattern, not those of projects inside it */
    #filesOf({ directory, root }: Scope, pattern: string): string[] {
        const from = resolve(this.#cwd, directory);

        return globSync(pattern, { cwd: from, exclude: EXCLUDED })
            .filter(
                file =>
                    this.#projects.of(resolve(from, file))?.directory === root
            )
            .map(file => (directory === '' ? file : join(directory, file)))
            .toSorted()
            .map(file => escapeGlob(file));
    }
}
