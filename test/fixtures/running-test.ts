// Tests that `declarations.test.ts` runs, and checks the results of, by
// their titles: those of the members of Vitest's API that need the test that
// is running. Its tests fail where they should.
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    onTestFailed,
    onTestFinished,
    test,
    vi
} from 'hypotes';
import { fc, it as property } from 'hypotes/fast-check';

/** Resolves after the milliseconds, in real time */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

/** The error that a call throws, outside a test */
function errorOf(call: () => unknown): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }

    return undefined;
}

const outside = {
    onTestFinished: errorOf(() => {
        onTestFinished(() => {});
    }),
    // oxlint-disable-next-line hypotes/no-standalone-expect -- Outside a test on purpose
    soft: errorOf(() => expect.soft(1).toBe(1)),
    // oxlint-disable-next-line hypotes/no-standalone-expect, hypotes/valid-expect -- Outside a test on purpose, where it throws before a matcher
    poll: errorOf(() => expect.poll(() => 1))
};

it('throws outside a test, with Vitest messages', () => {
    expect(outside).toEqual({
        onTestFinished: new Error(
            'Hook onTestFinished() can only be called inside a test'
        ),
        soft: new Error('expect.soft() can only be used inside a test'),
        poll: new Error('expect.poll() must be called inside a test')
    });
});

const calls: string[] = [];

describe('the end of a test', () => {
    beforeEach(() => {
        onTestFinished(() => {
            calls.push('finished, from beforeEach');
        });
        return () => {
            calls.push('beforeEach cleanup');
        };
    });
    afterEach(() => {
        calls.push('afterEach');
    });

    it('runs its callbacks after afterEach, the last first', () => {
        onTestFinished(() => {
            calls.push('finished 1');
        });
        onTestFinished(async () => {
            await delay(1);
            calls.push('finished 2');
        });
        onTestFailed(() => {
            calls.push('failed, which it does not');
        });

        expect(calls).toEqual([]);
    });

    it('runs the callbacks of a failed test after the others', () => {
        onTestFailed(context => {
            calls.push(`failed 1, ${context.name}`);
        });
        onTestFailed(() => {
            calls.push('failed 2');
        });
        onTestFinished(() => {
            calls.push('finished');
        });

        expect('test').toBe('passed');
    });
});

it('ran the callbacks in the order that Vitest runs them', () => {
    // hypotes runs a cleanup of beforeEach as an afterEach hook declared
    // with it, so before the afterEach hooks declared after it
    expect(calls).toEqual([
        'beforeEach cleanup',
        'afterEach',
        'finished 2',
        'finished 1',
        'finished, from beforeEach',
        'beforeEach cleanup',
        'afterEach',
        'finished',
        'finished, from beforeEach',
        'failed 2',
        'failed 1, runs the callbacks of a failed test after the others'
    ]);
});

it('fails with the error of a callback, and runs the others', () => {
    onTestFinished(() => {
        calls.push('finished after the callback that threw');
    });
    onTestFinished(() => {
        throw new Error('the callback threw');
    });

    expect(calls).not.toContain('finished after the callback that threw');
});

it('ran the callbacks after the one that threw', () => {
    expect(calls.at(-1)).toBe('finished after the callback that threw');
});

it('fails with the errors of two callbacks', () => {
    onTestFinished(() => {
        throw new Error('the first callback threw');
    });
    onTestFinished(() => {
        throw new Error('the second callback threw');
    });

    expect(calls).toContain('finished after the callback that threw');
});

it('fails with a callback that times out', () => {
    onTestFinished(() => new Promise(() => {}), 10);

    expect(calls).toContain('finished after the callback that threw');
});

describe('a beforeEach hook that throws', () => {
    beforeEach(() => {
        onTestFailed(() => {
            calls.push('failed, from a beforeEach hook that threw');
        });
        throw new Error('beforeEach threw');
    });

    it('still runs the callbacks of the hook', () => {
        expect('never').toBe('run');
    });
});

it('ran the callbacks of a test whose beforeEach hook threw', () => {
    expect(calls.at(-1)).toBe('failed, from a beforeEach hook that threw');
});

it('has the callbacks on its context, with expect', context => {
    context.onTestFinished(() => {
        calls.push('finished, from the context');
    });
    context.onTestFailed(() => {
        calls.push('failed, from the context, which it does not');
    });

    expect(context.expect).toBe(expect);
    expect(context.name).toBe('has the callbacks on its context, with expect');
});

it.for(['row'])('has the callbacks on the context of %s', (row, context) => {
    context.onTestFinished(() => {
        calls.push(`finished, from the context of ${row}`);
    });

    expect(calls.at(-1)).toBe('finished, from the context');
});

it('ran the callbacks of the context', () => {
    expect(calls.slice(-2)).toEqual([
        'finished, from the context',
        'finished, from the context of row'
    ]);
});

it('has a context whose callbacks throw in a callback', context => {
    onTestFinished(() => {
        context.onTestFinished(() => {});
    });

    expect(context.name).toBe(
        'has a context whose callbacks throw in a callback'
    );
});

it('fails with each error of its soft assertions, and goes on', () => {
    expect.soft(1).toBe(2);
    expect.soft({ a: 1 }, 'an object').toEqual({ a: 2 });
    calls.push('went on after the soft assertions');
});

it('went on after the soft assertions', () => {
    expect(calls.at(-1)).toBe('went on after the soft assertions');
});

it('passes with soft assertions that pass', () => {
    expect.soft(1).toBe(1);
});

it('fails with a soft assertion and what it throws after', () => {
    expect.soft('soft').toBe('hard');
    throw new Error('threw after');
});

it('fails with a soft assertion that a promise fails', async () => {
    await expect.soft(Promise.resolve(1)).resolves.toBe(2);
});

/** A soft assertion, for a hook */
function expectPassing(value: string): void {
    expect.soft(value).toBe('passing');
}

describe('a soft assertion in afterEach', () => {
    afterEach(() => {
        expectPassing('afterEach');
    });

    it('fails the test', () => {
        expect(1).toBe(1);
    });
});

it('runs onTestFailed for a soft assertion', () => {
    onTestFailed(() => {
        calls.push('failed, from a soft assertion');
    });

    expect.soft(1).toBe(2);
});

it('ran onTestFailed for a soft assertion', () => {
    expect(calls.at(-1)).toBe('failed, from a soft assertion');
});

it('passes with as many assertions as expected', () => {
    expect.assertions(3);

    // oxlint-disable-next-line hypotes/valid-expect -- Its matchers are called on the variable, and it counts once
    const assertion = expect(1);
    assertion.toBe(1);
    assertion.toBeTypeOf('number');
    expect.soft(1).toBe(1);
    expect([1]).toHaveLength(1);
});

it('fails with fewer assertions than expected', () => {
    expect.assertions(2);
    expect(1).toBe(1);
});

// oxlint-disable-next-line hypotes/expect-expect -- Fails by expect.hasAssertions()
it('fails with no assertions when it expects some', () => {
    expect.hasAssertions();
});

it('passes with an assertion when it expects some', () => {
    expect.hasAssertions();
    expect(1).toBe(1);
});

// oxlint-disable-next-line hypotes/expect-expect -- Fails by what it throws
it('fails with what it throws rather than its count of assertions', () => {
    expect.assertions(5);
    throw new Error('threw rather than counted');
});

it('fails with a promise that it did not await', () => {
    // oxlint-disable-next-line hypotes/valid-expect -- Not awaited on purpose
    void expect(Promise.resolve(1)).resolves.toBe(1);
});

describe('tests that run at once', { concurrency: true }, () => {
    it('counts the assertions of its own, while another runs', async () => {
        expect.assertions(1);
        await delay(20);
        expect(1).toBe(1);
    });

    it('counts its own assertions too', async () => {
        expect.assertions(2);
        await delay(10);
        expect(1).toBe(1);
        expect(2).toBe(2);
    });

    it('collects its own soft errors, while another runs', async () => {
        await delay(20);
        expect.soft('first').toBe('1');
    });

    it('collects its own soft errors too', async () => {
        await delay(10);
        expect.soft('second').toBe('2');
    });
});

property.prop([fc.nat()], { numRuns: 3 })(
    'counts the assertions of each run of a property',
    count => {
        expect.assertions(3);
        expect(count).toBeGreaterThanOrEqual(0);
    }
);

it('polls until the matcher passes', async () => {
    let count = 0;
    await expect.poll(() => ++count, { interval: 1 }).toBe(3);

    expect(count).toBe(3);
});

it('polls with a negated matcher', async () => {
    let count = 0;
    await expect.poll(() => ++count, { interval: 1 }).not.toBe(1);

    expect(count).toBe(2);
});

it('fails with the last error of a poll', async () => {
    await expect
        .poll(() => 1, { interval: 1, timeout: 20, message: 'the value' })
        .toBe(2);
});

it('fails with a poll that it did not await', () => {
    // oxlint-disable-next-line hypotes/valid-expect -- Not awaited on purpose
    void expect.poll(() => 1).toBe(1);
});

describe('with fake timers', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('polls in real time, and moves fake timers forward', async () => {
        vi.useFakeTimers();
        let done = false;
        setTimeout(() => {
            done = true;
        }, 200);

        await expect.poll(() => done, { interval: 50 }).toBe(true);
    });
});

it.fails('fails passes a test that throws', () => {
    expect(1).toBe(2);
});

it.fails('fails fails a test that passes', () => {
    expect(1).toBe(1);
});

it.fails('fails passes a test with a soft failure', () => {
    expect.soft(1).toBe(2);
});

// oxlint-disable-next-line hypotes/expect-expect -- Fails by its count of assertions
it.fails('fails passes a test with fewer assertions than expected', () => {
    expect.assertions(1);
});

it('fails as an option', { fails: true }, () => {
    expect(1).toBe(2);
});

test.fails.each([1, 2])('fails.each %i', value => {
    expect(value).toBe(1);
});

it.skip.fails('skip.fails skips', () => {
    expect(1).toBe(1);
});

describe('a describe block that fails', { fails: true }, () => {
    it('passes its test that throws', () => {
        expect(1).toBe(2);
    });

    it('fails its test that passes', () => {
        expect(1).toBe(1);
    });
});

property.fails.prop([fc.nat()])(
    'fails.prop passes a failed property',
    count => {
        expect(count).toBeLessThan(0);
    }
);
