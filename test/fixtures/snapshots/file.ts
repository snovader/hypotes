import { describe, expect, it } from 'hypotes';

it('text', async () => {
    await expect('line one\nline two\n').toMatchFileSnapshot(
        './golden/text.txt'
    );
});

it('existing', async () => {
    await expect('<p>kept</p>\n').toMatchFileSnapshot('./golden/existing.html');
});

it('crlf', async () => {
    await expect('a\nb\n').toMatchFileSnapshot('./golden/crlf.txt');
});

describe('values', () => {
    it('object', async () => {
        await expect({ a: 1, b: ['c'] }).toMatchFileSnapshot(
            './golden/object.txt'
        );
    });

    it('nested directory', async () => {
        await expect('deep').toMatchFileSnapshot(
            './golden/made/deep/file.txt',
            'hint'
        );
    });

    it('with a snapshot too', async () => {
        expect('in snap').toMatchSnapshot();
        await expect('in file').toMatchFileSnapshot('./golden/both.txt');
        expect('in snap again').toMatchSnapshot();
    });
});
