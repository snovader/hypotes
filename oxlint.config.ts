import oxlint from '@snovader/oxc-config/oxlint';
import { defineConfig } from 'oxlint';

export default defineConfig({
    extends: [oxlint],
    ignorePatterns: ['.yarn', 'dist'],
    // The rules for tests that this package publishes, which lint its own
    // tests from source. `@snovader/oxc-config/oxlint/hypotes` turns on the
    // same rules, but loads them from the published `hypotes/oxlint`, which
    // it resolves from its own location, so this list stays in step with that
    // preset's.
    jsPlugins: ['./source/oxlint/index.ts'],
    rules: {
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
                        regex: '^#source/(index|cli|fast-check|register|reporter|oxlint/index)$',
                        message:
                            'Import an entry point by the name that the package exports it under.'
                    }
                ]
            }
        ],

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
        'hypotes/hoisted-apis-on-top': 'error'
    },
    overrides: [
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
            // Fixtures of other packages, for the reporter, which can't
            // import hypotes: they declare node:test's tests, which return
            // promises, and assert nothing
            files: ['test/fixtures/projects/**'],
            rules: {
                'hypotes/expect-expect': 'off',
                'typescript/no-floating-promises': 'off'
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
            // oxlint reads its plugins from default exports, and node:test
            // its reporters
            files: [
                'source/oxlint/index.ts',
                'source/reporter.ts',
                'test/fixtures/entry-file.ts'
            ],
            rules: {
                'import/no-default-export': 'off'
            }
        }
    ]
});
