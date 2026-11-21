import { join, parse } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'hypotes';
import { Projects } from '#source/project';

const ALPHA = fileURLToPath(new URL('fixtures/projects/alpha', import.meta.url));

describe('Projects', () => {
    it('should name a file by the nearest package.json above it', () => {
        const project = new Projects().of(join(ALPHA, 'test', 'passes.spec.ts'));

        expect(project).toStrictEqual({ name: '@fixture/alpha', directory: ALPHA });
    });

    it('should pass over a package.json without a name', () => {
        const project = new Projects().of(join(ALPHA, 'test', 'nested', 'deep.spec.ts'));

        expect(project).toStrictEqual({ name: '@fixture/alpha', directory: ALPHA });
    });

    it('should give the same project to each file of a directory', () => {
        const projects = new Projects();

        expect(projects.of(join(ALPHA, 'test', 'mixed.spec.ts'))).toBe(
            projects.of(join(ALPHA, 'test', 'passes.spec.ts'))
        );
    });

    it('should have no project for a file that no package is above', () => {
        const { root } = parse(process.cwd());

        expect(new Projects().of(join(root, 'hypotes-no-package', 'a.ts'))).toBeUndefined();
    });
});
