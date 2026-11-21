import { describe, expect } from 'hypotes';
import { fc, it } from 'hypotes/fast-check';
import { ProjectFilter } from '#source/project-filter';

/** Names of projects, with the characters that mean something in a regular expression */
const name = fc.stringMatching(/^[@a-z/.+()[\]-]+$/);

describe('ProjectFilter', () => {
    it('should select every project without patterns', () => {
        expect(new ProjectFilter([]).matches('@acme/api')).toBe(true);
    });

    it.prop([name, name])('should select a project by its whole name', (project, other) => {
        const filter = new ProjectFilter([project]);

        expect(filter.matches(project)).toBe(true);
        expect(filter.matches(other)).toBe(other === project);
    });

    it("should select a project whatever the case of its name's letters", () => {
        const filter = new ProjectFilter(['@ACME/api', '!@acme/WEB']);

        expect(
            ['@acme/api', '@Acme/API', '@acme/web', 'docs'].filter(each => filter.matches(each))
        ).toStrictEqual(['@acme/api', '@Acme/API']);
    });

    it.prop([name, name, name])('should take * for any characters', (prefix, middle, suffix) => {
        const filter = new ProjectFilter([`${prefix}*${suffix}`]);

        expect(filter.matches(prefix + middle + suffix)).toBe(true);
        expect(filter.matches(prefix + suffix)).toBe(true);
    });

    it('should not take * across the ends of a name', () => {
        const filter = new ProjectFilter(['@acme/*']);

        expect(filter.matches('@acme/api')).toBe(true);
        expect(filter.matches('other-@acme/api')).toBe(false);
    });

    it('should select a project that any of the patterns matches', () => {
        const filter = new ProjectFilter(['api', 'web']);

        expect(['api', 'web', 'docs'].filter(each => filter.matches(each))).toStrictEqual([
            'api',
            'web'
        ]);
    });

    it.prop([name, name])(
        'should leave out a project that a pattern with ! matches',
        (project, other) => {
            const filter = new ProjectFilter([`!${project}`]);

            expect(filter.matches(project)).toBe(false);
            expect(filter.matches(other)).toBe(other !== project);
        }
    );

    it('should leave out a project that a pattern with ! matches from those that the others select', () => {
        const filter = new ProjectFilter(['@acme/*', '!@acme/web']);

        expect(
            ['@acme/api', '@acme/web', 'docs'].filter(each => filter.matches(each))
        ).toStrictEqual(['@acme/api']);
    });
});
