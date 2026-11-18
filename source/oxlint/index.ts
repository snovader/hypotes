// Rules for tests written with this package, which oxlint loads as a JS
// plugin: `"jsPlugins": ["hypotes/oxlint"]`, and rules such as
// `"hypotes/expect-expect": "error"`
import {
    expectExpect,
    noStandaloneExpect,
    preferToBe,
    preferToHaveLength,
    validExpect
} from './rules.ts';
import type { Rule } from './types.ts';

export interface Plugin {
    readonly meta: { readonly name: string };
    readonly rules: Readonly<Record<string, Rule>>;
}

const plugin: Plugin = {
    meta: { name: 'hypotes' },
    rules: {
        'expect-expect': expectExpect,
        'no-standalone-expect': noStandaloneExpect,
        'valid-expect': validExpect,
        'prefer-to-be': preferToBe,
        'prefer-to-have-length': preferToHaveLength
    }
};

export default plugin;
