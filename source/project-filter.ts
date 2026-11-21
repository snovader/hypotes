// The projects that `--project` names, as Vitest's flag of the same name
// selects them: by name, whatever the case of its letters, with `*` for any
// characters, and with a leading `!` to leave projects out

/** A pattern as a regular expression of a whole name, in which `*` is any characters */
function toRegExp(pattern: string): RegExp {
    const literals = pattern.split('*').map(literal => RegExp.escape(literal));

    return new RegExp(`^${literals.join('.*')}$`, 'iu');
}

/** Selects projects by the patterns of `--project` */
export class ProjectFilter {
    readonly #included: readonly RegExp[];
    readonly #excluded: readonly RegExp[];

    /**
     * Of patterns such as `@acme/api`, `@acme/*` and `!@acme/web`. A
     * pattern that is empty, or only `!`, matches no project.
     */
    constructor(patterns: readonly string[]) {
        const excluded = patterns.filter(pattern => pattern.startsWith('!'));
        const included = patterns.filter(pattern => !pattern.startsWith('!'));

        this.#included = included.map(pattern => toRegExp(pattern));
        this.#excluded = excluded.map(pattern => toRegExp(pattern.slice(1)));
    }

    /**
     * Whether a project of the name is selected: no pattern with `!` matches
     * it, and one of the others does, if there are others
     */
    matches(name: string): boolean {
        if (this.#excluded.some(pattern => pattern.test(name))) {
            return false;
        }

        return (
            this.#included.length === 0 ||
            this.#included.some(pattern => pattern.test(name))
        );
    }
}
