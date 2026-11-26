import oxfmt from '@snovader/oxc-config/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig({
    ...oxfmt,
    ignorePatterns: [
        '.yarn',
        'dist',
        // Yarn writes these in a format of its own
        '**/package.json',
        // Prose wrapped by hand
        '**/*.md',
        // Whose lines end in CRLF, which it tests
        'test/fixtures/crlf.ts',
        // Whose inline snapshots are written where the calls are laid out,
        // and compared with what Vitest wrote there
        'test/fixtures/snapshots',
        'test/fixtures/snapshots-by-vitest'
    ],
    // This package by the names that it exports, after other packages
    sortImports: { ...oxfmt.sortImports, internalPattern: ['hypotes'] }
});
