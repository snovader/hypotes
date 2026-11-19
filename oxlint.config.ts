import { defineConfig } from 'oxlint';

export default defineConfig({
    ignorePatterns: ['.yarn', 'dist'],
    options: {
        // Rules marked as type-aware run through tsgolint, on TypeScript 7
        typeAware: true,
        reportUnusedDisableDirectives: 'error'
    },
    plugins: [
        'eslint',
        'typescript',
        'unicorn',
        'oxc',
        'import',
        'jsdoc',
        'promise'
    ],
    // This repository's rules, then the rules for tests that this package
    // publishes, which lint its own tests
    jsPlugins: ['./lint/plugin.ts', './source/oxlint/index.ts'],
    // Every rule of these categories runs, except those turned off below. Rules
    // of the style and restriction categories run only when listed, as most
    // describe a house style other than this one, and a new version of oxlint
    // adds rules to them.
    categories: {
        correctness: 'error',
        suspicious: 'error',
        pedantic: 'error',
        perf: 'error'
    },
    rules: {
        // Arrays of simple types use `T[]` and `readonly T[]`, and all others
        // `Array<T>` and `ReadonlyArray<T>`: `number[][]` and `Buffer[]`, but
        // `Array<Span<Date>>` and `Array<[key: string, value: number]>`
        'typescript/array-type': ['error', { default: 'array-simple' }],
        // Declarations, class members, and functions bound to variables declare
        // their return types. Inline callbacks don't need one, and neither do
        // functions that TypeScript types from where they appear.
        'typescript/explicit-function-return-type': [
            'error',
            {
                allowExpressions: true,
                allowTypedFunctionExpressions: true,
                allowHigherOrderFunctions: true,
                allowDirectConstAssertionInArrowFunctions: true,
                allowIIFEs: true
            }
        ],
        // A `default` case counts as handling the rest
        'typescript/switch-exhaustiveness-check': [
            'error',
            { considerDefaultExhaustiveForUnions: true }
        ],
        // A `never` is what a check of a value from outside TypeScript prints
        'typescript/restrict-template-expressions': [
            'error',
            { allowNever: true }
        ],
        'typescript/no-confusing-void-expression': [
            'error',
            { ignoreArrowShorthand: true }
        ],
        'eslint/no-inline-comments': 'error',

        // Types at the API's boundaries
        'typescript/consistent-type-definitions': ['error', 'interface'],
        'typescript/consistent-type-imports': 'error',
        'typescript/consistent-type-exports': 'error',
        'typescript/no-import-type-side-effects': 'error',
        'typescript/no-inferrable-types': 'error',
        'typescript/no-explicit-any': 'error',
        'typescript/prefer-readonly': 'error',
        'typescript/consistent-generic-constructors': 'error',
        'typescript/consistent-indexed-object-style': 'error',
        'typescript/no-empty-interface': 'error',
        'typescript/no-namespace': 'error',
        'typescript/prefer-as-const': 'error',
        'typescript/prefer-function-type': 'error',
        'typescript/no-non-null-asserted-nullish-coalescing': 'error',

        // Errors that callers can tell apart, with their causes
        'typescript/only-throw-error': 'error',
        'unicorn/throw-new-error': 'error',
        'unicorn/error-message': 'error',
        'unicorn/prefer-type-error': 'error',
        'eslint/preserve-caught-error': 'error',

        // Modules
        'import/first': 'error',
        'import/no-cycle': 'error',
        'import/no-default-export': 'error',
        'import/no-duplicates': 'error',
        'import/no-empty-named-blocks': 'error',
        'import/no-mutable-exports': 'error',
        'unicorn/prefer-node-protocol': 'error',
        // Files are named in kebab-case, whatever they export, so that an
        // import path reads the same on file systems that ignore case
        'unicorn/filename-case': ['error', { case: 'kebabCase' }],
        // A module in a parent directory is imported by a private path of
        // package.json's `imports`, such as `#source/title`, rather than by
        // `../`
        'import/no-relative-parent-imports': 'error',
        // An entry point is imported by the name that package.json's
        // `exports` give it, such as `hypotes/fast-check`, which names the
        // bundle when the tests run on it, and which `vi` has to come from
        // to be hoisted
        'eslint/no-restricted-imports': [
            'error',
            {
                patterns: [
                    {
                        regex: '^#source/(index|fast-check|register|oxlint/index)$',
                        message:
                            'Import an entry point by the name that the package exports it under.'
                    }
                ]
            }
        ],
        // Named imports list functions and values whose names start in lower
        // case, then classes and constants, then types, each in natural order:
        // `SIZEOF_8` before `SIZEOF_16`
        'local/sort-named-imports': 'error',

        'eslint/curly': 'error',
        'eslint/default-param-last': 'error',
        'eslint/eqeqeq': 'error',
        'eslint/no-else-return': ['error', { allowElseIf: false }],
        'eslint/no-lonely-if': 'error',
        'eslint/no-param-reassign': 'error',
        'eslint/no-useless-computed-key': 'error',
        'eslint/no-useless-constructor': 'error',
        'eslint/no-useless-rename': 'error',
        'eslint/no-var': 'error',
        'eslint/prefer-const': 'error',
        'eslint/prefer-exponentiation-operator': 'error',
        'eslint/prefer-object-has-own': 'error',
        'eslint/prefer-rest-params': 'error',
        'eslint/prefer-spread': 'error',
        'unicorn/no-useless-spread': 'error',
        'unicorn/no-zero-fractions': 'error',
        'unicorn/prefer-bigint-literals': 'error',
        'unicorn/prefer-number-properties': 'error',
        'unicorn/prefer-structured-clone': 'error',

        // Tests, in place of oxlint's vitest rules, which see only what is
        // imported from vitest: `source/oxlint/rules.ts` describes what they
        // see. Each test asserts, assertions name and call their matchers, and
        // helpers whose names start with `expect` assert.
        'hypotes/expect-expect': 'error',
        'hypotes/no-standalone-expect': 'error',
        'hypotes/valid-expect': 'error',
        'hypotes/valid-expect-in-promise': 'error',
        'hypotes/require-to-throw-message': 'error',
        // `toBe` compares with Object.is, which tells -0 from 0
        'hypotes/prefer-to-be': 'error',
        'hypotes/prefer-to-have-length': 'error',
        // Every test runs, declared unconditionally, with a valid title, and
        // describe blocks declare them in functions written in place
        'hypotes/no-focused-tests': 'error',
        'hypotes/no-disabled-tests': 'error',
        'hypotes/warn-todo': 'error',
        'hypotes/no-conditional-tests': 'error',
        'hypotes/valid-title': 'error',
        'hypotes/valid-describe-callback': 'error',
        // Mocks are typed, and hoisted from where they're written
        'hypotes/require-mock-type-parameters': 'error',
        'hypotes/hoisted-apis-on-top': 'error',

        // Turned off

        // TypeScript reports these itself, with this project's tsconfig
        'eslint/constructor-super': 'off',
        'eslint/getter-return': 'off',
        'eslint/no-class-assign': 'off',
        'eslint/no-const-assign': 'off',
        'eslint/no-delete-var': 'off',
        'eslint/no-dupe-class-members': 'off',
        'eslint/no-dupe-keys': 'off',
        'eslint/no-fallthrough': 'off',
        'eslint/no-func-assign': 'off',
        'eslint/no-import-assign': 'off',
        'eslint/no-new-native-nonconstructor': 'off',
        'eslint/no-obj-calls': 'off',
        'eslint/no-redeclare': 'off',
        'eslint/no-setter-return': 'off',
        'eslint/no-this-before-super': 'off',
        'eslint/no-unreachable': 'off',
        'eslint/no-unsafe-negation': 'off',
        'eslint/no-unsafe-optional-chaining': 'off',
        'eslint/no-unused-labels': 'off',
        'eslint/no-unused-private-class-members': 'off',
        'eslint/no-with': 'off',
        'eslint/use-isnan': 'off',
        'eslint/valid-typeof': 'off',
        'import/default': 'off',
        'import/namespace': 'off',

        // Values from tests are passed to be compared, and recorded
        'typescript/prefer-readonly-parameter-types': 'off',
        // Code that wraps other libraries asserts the types that they leave
        // out, such as of chai's `expect`, rather than checking them again
        'typescript/no-unsafe-type-assertion': 'off',
        // TypeScript checks that every path returns or throws
        'typescript/consistent-return': 'off',
        // Named callbacks, local helpers, named conversions, and typed defaults
        'unicorn/no-array-callback-reference': 'off',
        'unicorn/consistent-function-scoping': 'off',
        'unicorn/prefer-native-coercion-functions': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/no-object-as-default-parameter': 'off',
        'eslint/no-shadow': 'off',
        // No arbitrary limits of length
        'eslint/max-lines': 'off',
        'eslint/max-lines-per-function': 'off',
        'eslint/max-classes-per-file': 'off',
        'eslint/max-depth': 'off',
        'eslint/max-nested-callbacks': 'off',
        'import/max-dependencies': 'off',
        // Comments are prose, and TypeScript holds the types: JSDoc's tags
        // describe what isn't obvious, rather than every parameter
        'jsdoc/require-param': 'off',
        'jsdoc/require-param-description': 'off',
        'jsdoc/require-param-type': 'off',
        'jsdoc/require-property-description': 'off',
        'jsdoc/require-returns': 'off',
        'jsdoc/require-returns-description': 'off',
        'jsdoc/require-returns-type': 'off',
        'jsdoc/require-throws-type': 'off',
        'jsdoc/require-yields': 'off',
        'jsdoc/require-yields-type': 'off'
    },
    overrides: [
        {
            // Tests pass mocks, and callbacks that return values, to setters
            // that take callbacks that return nothing, and allocate arrays of
            // holes, which `toStrictEqual` tells from arrays of undefined
            files: ['**/*.test.ts'],
            rules: {
                'typescript/strict-void-return': 'off',
                'unicorn/no-new-array': 'off'
            }
        },
        {
            // Fixtures declare tests that are focused, skipped and to do, whose
            // results the tests check
            files: ['test/fixtures/**'],
            rules: {
                'hypotes/no-focused-tests': 'off',
                'hypotes/no-disabled-tests': 'off',
                'hypotes/warn-todo': 'off'
            }
        },
        {
            // Fixtures that call vi.mock() and vi.hoisted() where
            // hypotes/register rejects them, at the positions that the tests
            // check
            files: ['test/fixtures/declares.ts', 'test/fixtures/nested.ts'],
            rules: {
                'hypotes/hoisted-apis-on-top': 'off'
            }
        },
        {
            // rolldown, oxlint and oxfmt read their configurations, and oxlint
            // its plugins, from default exports
            files: ['*.config.ts', 'lint/plugin.ts', 'source/oxlint/index.ts'],
            rules: {
                'import/no-default-export': 'off'
            }
        }
    ]
});
