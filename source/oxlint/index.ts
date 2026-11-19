// Rules for tests written with this package, which oxlint loads as a JS
// plugin: `"jsPlugins": ["hypotes/oxlint"]`, and rules such as
// `"hypotes/expect-expect": "error"`
import {
    expectExpect,
    hoistedApisOnTop,
    noConditionalTests,
    noDisabledTests,
    noFocusedTests,
    noStandaloneExpect,
    preferToBe,
    preferToHaveLength,
    requireMockTypeParameters,
    requireToThrowMessage,
    validDescribeCallback,
    validExpect,
    validExpectInPromise,
    validTitle,
    warnTodo
} from './rules.ts';
import type { Rule } from './types.ts';

export interface Plugin {
    readonly meta: { readonly name: string };
    readonly rules: Readonly<Record<string, Rule>>;
}

const plugin: Plugin = {
    meta: { name: 'hypotes' },
    rules: {
        // Declarations
        'no-focused-tests': noFocusedTests,
        'no-disabled-tests': noDisabledTests,
        'warn-todo': warnTodo,
        'no-conditional-tests': noConditionalTests,
        'valid-title': validTitle,
        'valid-describe-callback': validDescribeCallback,

        // Assertions
        'expect-expect': expectExpect,
        'no-standalone-expect': noStandaloneExpect,
        'valid-expect': validExpect,
        'valid-expect-in-promise': validExpectInPromise,
        'require-to-throw-message': requireToThrowMessage,
        'prefer-to-be': preferToBe,
        'prefer-to-have-length': preferToHaveLength,

        // Mocks
        'hoisted-apis-on-top': hoistedApisOnTop,
        'require-mock-type-parameters': requireMockTypeParameters
    }
};

export default plugin;
