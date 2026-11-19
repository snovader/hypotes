import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'hypotes';
import plugin from 'hypotes/oxlint';

// The README names the rules and the members of `vi` one by one, which a
// change to either would leave behind: these compare its lists with what the
// package exports. Its samples are run by hand, as AGENTS.md says.
const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');

/** The text of the README from `start` up to `end` */
function section(start: string, end: string): string {
    const from = readme.indexOf(start);
    expect(from).not.toBe(-1);

    return readme.slice(from, readme.indexOf(end, from + start.length));
}

/** What `pattern` captures in each of its matches, in order */
function captures(text: string, pattern: RegExp): string[] {
    return Array.from(text.matchAll(pattern), match => match[1]).toSorted();
}

describe('README', () => {
    const rules = Object.keys(plugin.rules).toSorted();
    const oxlint = section('### `hypotes/oxlint`', '\n### ');

    it('configures each rule of hypotes/oxlint', () => {
        expect(captures(oxlint, /"hypotes\/([a-z-]+)":/gu)).toEqual(rules);
    });

    it('describes each rule of hypotes/oxlint', () => {
        expect(captures(oxlint, /^\| `([a-z-]+)`/gmu)).toEqual(rules);
    });

    it('lists each member of vi', () => {
        const members = section('with these members:', '\n\n');

        expect(captures(members, /`([A-Za-z]+)`/gu)).toEqual(Object.keys(vi).toSorted());
    });
});
