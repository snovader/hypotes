import { join } from 'node:path';
import { defineConfig } from 'rolldown';
import packageJson from './package.json' with { type: 'json' };

/** The packages that the package's dependents install, which stay imports */
const EXTERNAL: readonly string[] = [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.peerDependencies)
];

/** Whether an import names one of the external packages, or a subpath of one */
function isExternal(id: string): boolean {
    return EXTERNAL.some(name => id === name || id.startsWith(`${name}/`));
}

/**
 * Bundles each of the package's entry points into one module in `dist/`, as
 * it's published. Modules that more than one entry point imports, such as
 * `tests.ts`, go into a chunk that they share, so that `hypotes` and
 * `hypotes/fast-check` declare tests through the same code. tsc writes the
 * declarations beside them, with `tsconfig.dist.json`.
 */
export default defineConfig({
    input: {
        index: join(import.meta.dirname, 'source/index.ts'),
        'fast-check': join(import.meta.dirname, 'source/fast-check.ts'),
        'oxlint/index': join(import.meta.dirname, 'source/oxlint/index.ts'),
        register: join(import.meta.dirname, 'source/register.ts'),
        reporter: join(import.meta.dirname, 'source/reporter.ts')
    },
    platform: 'node',
    external: isExternal,
    output: {
        dir: join(import.meta.dirname, 'dist'),
        format: 'esm',
        // Empties it first, as `rm -rf dist` would, which Yarn's shell runs
        // from the system, and Windows doesn't have
        cleanDir: true
    }
});
