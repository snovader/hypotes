// The project of a test file, as Vitest names a project of a workspace: the
// nearest package above the file whose package.json has a name
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** A package that test files belong to */
export interface Project {
    /** The `name` of its package.json */
    readonly name: string;
    /** The directory of its package.json */
    readonly directory: string;
}

/**
 * The name of the package.json in the directory, or undefined if it has
 * none: without the file, without a name in it, or if it can't be read or
 * parsed, which is the package's to report, not a reader's of its name.
 */
function packageName(directory: string): string | undefined {
    try {
        const { name } = JSON.parse(
            readFileSync(join(directory, 'package.json'), 'utf8')
        ) as { name?: unknown };

        return typeof name === 'string' && name !== '' ? name : undefined;
    } catch {
        return undefined;
    }
}

/** The projects of files, which it reads once for each directory */
export class Projects {
    /** Null for a directory that has no project, which was looked for */
    readonly #byDirectory = new Map<string, Project | null>();

    /**
     * The project of the file at the absolute path, or undefined if no
     * directory above it has a package.json with a name. A package.json
     * without one, such as one that only sets `type`, is passed over.
     */
    of(file: string): Project | undefined {
        return this.#in(dirname(file));
    }

    #in(directory: string): Project | undefined {
        const cached = this.#byDirectory.get(directory);
        if (cached !== undefined) {
            return cached ?? undefined;
        }

        const project = this.#find(directory);
        this.#byDirectory.set(directory, project ?? null);

        return project;
    }

    #find(directory: string): Project | undefined {
        const name = packageName(directory);

        if (name !== undefined) {
            return { name, directory };
        }

        // The root is its own parent
        const parent = dirname(directory);

        return parent === directory ? undefined : this.#in(parent);
    }
}
