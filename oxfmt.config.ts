import { defineConfig } from 'oxfmt';

export default defineConfig({
    ignorePatterns: [
        '.yarn',
        'dist',
        // Yarn writes these in a format of its own
        '**/package.json',
        // Prose wrapped by hand
        '**/*.md',
        // Whose lines end in CRLF, which it tests
        'test/fixtures/crlf.ts'
    ],
    endOfLine: 'lf',
    tabWidth: 4,
    printWidth: 80,
    singleQuote: true,
    quoteProps: 'as-needed',
    trailingComma: 'none',
    semi: true,
    arrowParens: 'avoid',
    bracketSpacing: true,
    bracketSameLine: false,
    objectWrap: 'preserve',
    // Node's modules, other packages, this package, then relative paths,
    // nearest last
    sortImports: {
        groups: [
            'builtin',
            'external',
            ['internal', 'subpath'],
            'parent',
            ['sibling', 'index'],
            'unknown'
        ],
        internalPattern: ['hypotes'],
        newlinesBetween: false
    },
    overrides: [
        {
            files: ['**/*.test.ts'],
            options: { printWidth: 100 }
        },
        {
            files: ['**/tsconfig.json', '**/tsconfig.*.json'],
            options: { printWidth: 60 }
        },
        {
            // GitHub's workflows and Dependabot's configuration, as GitHub's
            // documentation writes them
            files: ['**/*.yml', '**/*.yaml'],
            options: { tabWidth: 2, singleQuote: false }
        }
    ]
});
