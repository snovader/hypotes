import { pathToFileURL } from 'node:url';
import { describe, expect } from 'hypotes';
import { fc, it } from 'hypotes/fast-check';
import { parseStack } from '#source/stack';

/** A file's absolute path on this platform, and the URL that Node names it by */
const FILE = `${process.cwd()}/a.test.ts`;
const URL_OF_FILE = pathToFileURL(FILE).href;
const PATH_OF_FILE = parseStack(`Error\n    at ${URL_OF_FILE}:1:1`).frames[0]?.file;

describe('parseStack', () => {
    it('should give the name and the message as the head, and the frames in order', () => {
        const stack = [
            'AssertionError: one is not two',
            '',
            '1 !== 2',
            '',
            `    at TestContext.<anonymous> (${URL_OF_FILE}:9:20)`,
            '    at Test.runInAsyncScope (node:async_hooks:226:14)',
            `    at async ${URL_OF_FILE}:3:1`
        ].join('\n');

        expect(parseStack(stack)).toStrictEqual({
            head: 'AssertionError: one is not two\n\n1 !== 2',
            frames: [
                { file: PATH_OF_FILE, line: 9, column: 20 },
                { file: PATH_OF_FILE, line: 3, column: 1 }
            ]
        });
    });

    it('should give the path that a file URL names on this platform', () => {
        expect(pathToFileURL(PATH_OF_FILE ?? '').href).toBe(URL_OF_FILE);
    });

    it.each([
        ['a POSIX path', '/work/a.test.ts'],
        ['a path with a colon and a comma', '/work/a,b:c/a.test.ts'],
        ['a Windows path', 'C:\\work\\a.test.ts'],
        ['a Windows path with spaces and parentheses', 'C:\\my work (1)\\a.test.ts']
    ])('should read %s, which a source map names a file by', (_, file) => {
        const stack = `Error: failed\n    at <anonymous> (${file}:16:21)\n    at ${file}:1:2`;

        expect(parseStack(stack).frames).toStrictEqual([
            { file, line: 16, column: 21 },
            { file, line: 1, column: 2 }
        ]);
    });

    it.each([
        ["Node's internals", '    at Test.run (node:internal/test_runner/test:1402:25)'],
        ['code without a file', '    at new Promise (<anonymous>)'],
        [
            'evaluated code',
            '    at eval (eval at run (evalmachine.<anonymous>:1:1), <anonymous>:1:1)'
        ],
        ['a combinator', '    at async Promise.all (index 0)'],
        ['an installed package', '    at fn (file:///work/node_modules/pkg/index.js:1:1)'],
        [
            'an installed package on Windows',
            '    at fn (C:\\work\\node_modules\\pkg\\index.js:1:1)'
        ],
        ['a module of a data URL', '    at data:text/javascript,throw 1:1:7']
    ])('should leave out a frame in %s', (_, frame) => {
        expect(parseStack(`Error: failed\n${frame}`)).toStrictEqual({
            head: 'Error: failed',
            frames: []
        });
    });

    it('should take a stack without frames for its head', () => {
        expect(parseStack('Error: failed\n')).toStrictEqual({ head: 'Error: failed', frames: [] });
        const head = 'Error: invalid input\n    at least two values are required';
        expect(parseStack(head)).toStrictEqual({ head, frames: [] });
        expect(parseStack('')).toStrictEqual({ head: '', frames: [] });
    });

    it.prop([
        fc.array(
            fc.oneof(
                fc.string(),
                fc.constantFrom(
                    '    at least two',
                    '    at /work/b.ts:1:2',
                    '    at fn (/work/b.ts:3:4)'
                )
            ),
            { minLength: 1 }
        )
    ])(
        "should keep each line of the error's message in the head, even one that looks like a frame",
        lines => {
            const message = ['invalid input', ...lines].join('\n');
            const stack = `Error: ${message}\n    at fn (/work/a.ts:5:6)`;

            expect(parseStack(stack, message)).toStrictEqual({
                // Without the white space that ends the message, as a head has none
                head: `Error: ${message}`.trimEnd(),
                frames: [{ file: '/work/a.ts', line: 5, column: 6 }]
            });
        }
    );

    it("should look for the frames from the stack's start where its head isn't the message", () => {
        // As where the message changed after the stack was written
        const stack = 'Error: failed\n    at fn (/work/a.ts:5:6)';

        expect(parseStack(stack, 'failed\n    at fn (/work/b.ts:1:2)')).toStrictEqual({
            head: 'Error: failed',
            frames: [{ file: '/work/a.ts', line: 5, column: 6 }]
        });
    });

    it.prop([
        fc.array(
            fc.record({
                file: fc.constantFrom('/work/a.ts', 'C:\\work\\a.ts', '/a b/c:d.ts'),
                line: fc.integer({ min: 1, max: 1e6 }),
                column: fc.integer({ min: 1, max: 1e6 })
            })
        ),
        fc.boolean()
    ])('should read each frame of a stack that V8 writes', (frames, named) => {
        const lines = frames.map(({ file, line, column }) =>
            named ? `    at fn (${file}:${line}:${column})` : `    at ${file}:${line}:${column}`
        );

        expect(parseStack(['Error: failed', ...lines].join('\n'))).toStrictEqual({
            head: 'Error: failed',
            // Without the null prototype of fast-check's records
            frames: frames.map(frame => ({ ...frame }))
        });
    });
});
