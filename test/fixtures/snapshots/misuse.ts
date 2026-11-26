import { expect, it } from 'hypotes';

/** The first line of what the function throws, and its name */
function thrown(fn: () => unknown): string {
    try {
        fn();
    } catch (error) {
        const { name, message } = error as Error;
        return `${name}: ${message.split('\n')[0]}`;
    }
    return 'nothing';
}

async function rejected(fn: () => PromiseLike<unknown>): Promise<string> {
    try {
        await fn();
    } catch (error) {
        const { name, message } = error as Error;
        return `${name}: ${message.split('\n')[0]}`;
    }
    return 'nothing';
}

/** What the matchers throw where no test is running */
function outsideATest(): string[] {
    return [
        thrown(() => expect(1).toMatchSnapshot()),
        thrown(() => expect(1).toMatchInlineSnapshot()),
        thrown(() => expect(1).toMatchFileSnapshot('./golden/x.txt')),
        thrown(() => expect(1).not.toMatchSnapshot())
    ];
}

const outside = outsideATest();

it('outside a test', () => {
    expect(outside).toMatchInlineSnapshot();
});

it('not', () => {
    expect([
        thrown(() => expect(1).not.toMatchSnapshot()),
        thrown(() => expect(1).not.toMatchInlineSnapshot()),
        thrown(() => expect(() => 1).not.toThrowErrorMatchingSnapshot()),
        thrown(() => expect(() => 1).not.toThrowErrorMatchingInlineSnapshot()),
        thrown(() => expect(1).not.toMatchFileSnapshot('./golden/x.txt'))
    ]).toMatchInlineSnapshot();
});

it('throwing', () => {
    expect([
        thrown(() => expect(1).toThrowErrorMatchingSnapshot()),
        thrown(() => expect(() => 1).toThrowErrorMatchingSnapshot()),
        thrown(() => expect(() => 1).toThrowErrorMatchingInlineSnapshot())
    ]).toMatchInlineSnapshot();
});

it('properties', () => {
    expect([
        thrown(() => expect<unknown>(1).toMatchSnapshot({ a: 1 })),
        thrown(() => expect({ a: 2 }).toMatchSnapshot({ a: 1 })),
        thrown(() =>
            expect({ a: 2 }).toMatchSnapshot({ a: expect.any(String) }, 'hint')
        ),
        thrown(() =>
            expect({ a: 2 }, 'custom message').toMatchSnapshot({ a: 1 })
        )
    ]).toMatchInlineSnapshot();
});

it('file', async () => {
    expect(
        (
            await rejected(() =>
                expect('x').toMatchFileSnapshot(
                    './__snapshots__/misuse.ts.snap'
                )
            )
        ).replace(/: .*__snapshots__/, ': <dir>')
    ).toMatchInlineSnapshot();
});

it('mismatch with message', () => {
    expect('kept').toMatchInlineSnapshot(`"kept"`);
    expect([
        thrown(() => expect('a').toMatchInlineSnapshot(`"b"`)),
        thrown(() => expect('a', 'custom message').toMatchInlineSnapshot(`"b"`))
    ]).toMatchSnapshot();
});

it.fails('fails', () => {
    expect(1).toMatchSnapshot();
});

it.fails('fails for another reason', () => {
    expect(1).toBe(2);
});

it('soft', () => {
    expect.soft('soft').toMatchInlineSnapshot(`"hard"`);
    expect.soft('goes on').toMatchSnapshot();
});
