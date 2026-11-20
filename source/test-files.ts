// The test files of the projects that `--project` selects, which `cli.ts`
// names to node:test. node:test finds test files itself, but can't tell
// which package a file is in, so this finds them as it does: by its
// patterns, or its default one, leaving out `node_modules`, in order.
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProjectFilter } from './project-filter.ts';
import { Projects } from './project.ts';

/**
 * The pattern of the files that node:test runs when it's given none, which
 * its documentation lists. It takes TypeScript's extensions unless Node is
 * told not to strip types.
 */
export function defaultPattern(stripsTypes: boolean): string {
    const extensions = stripsTypes ? 'js,mjs,cjs,ts,mts,cts' : 'js,mjs,cjs';

    return `**/{test,test/**/*,test-*,*[._-]test}.{${extensions}}`;
}

/**
 * The files under `cwd` that match the glob patterns and are in a project
 * that the filter selects, by their paths from `cwd`. A file that no
 * package with a name is above is in no project.
 */
export function findProjectFiles(
    patterns: readonly string[],
    filter: ProjectFilter,
    cwd: string
): string[] {
    const projects = new Projects();
    const files = globSync([...patterns], {
        cwd,
        exclude: ['**/node_modules/**']
    });

    function isSelected(file: string): boolean {
        const project = projects.of(resolve(cwd, file));

        return project !== undefined && filter.matches(project.name);
    }

    return files.filter(file => isSelected(file)).toSorted();
}
