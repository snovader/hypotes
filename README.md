# hypotes

Vitest's API for tests that run on Node's test runner. Tests declared with
`describe`, `it`, `expect` and `vi` from hypotes run with `node --test`,
without Vite or a runner of its own, and node:test's reporters, timeouts,
`skip`, `todo` and `only` apply to them. It's for projects that want Vitest's
matchers, spies and module mocks on node:test: a test file that uses what both
have moves between them by changing its imports, apart from the differences
below.

hypotes needs Node 24.13.1 or later.

## Install and run

```bash
npm install --save-dev hypotes
```

```bash
node --import hypotes/register --test
```

`hypotes/register` installs the module mocks of `vi`, so only test files that
mock modules need it, and `node --test` alone runs the rest. node:test passes
it on to the process of each test file, and it can come from `NODE_OPTIONS`
too:

```bash
NODE_OPTIONS='--import hypotes/register' node --test
```

Test files can be TypeScript, which Node runs by stripping its types. The
examples below are ES modules, as in a package whose `package.json` has
`"type": "module"`, or none.

The optional peer dependencies are needed only by what uses them, so install
those that you use:

| Package                         | Needed by                                    |
| ------------------------------- | -------------------------------------------- |
| `fast-check`                    | `hypotes/fast-check`                         |
| `oxlint`                        | `hypotes/oxlint`                             |
| `oxc-parser` and `magic-string` | `vi.mock()`, which `hypotes/register` hoists |

```bash
npm install --save-dev oxc-parser magic-string
```

## Examples

```ts
import { describe, expect, it, vi } from 'hypotes';

describe('sum', () => {
    it('adds numbers', () => {
        expect(1 + 2).toBe(3);
    });

    it.each([
        [1, 1, 2],
        [2, 3, 5]
    ])('%i + %i = %i', (a, b, sum) => {
        expect(a + b).toBe(sum);
    });

    it('calls back', () => {
        const callback = vi.fn();
        [1, 2].forEach(callback);
        expect(callback).toHaveBeenCalledTimes(2);
    });
});
```

A module mock, written as for Vitest, with `vi.hoisted()` and
`importOriginal`:

```ts
// src/greet.ts
import { readFileSync } from 'node:fs';

export function greeting(): string {
    return `Hello, ${readFileSync('name.txt', 'utf8').trim()}!`;
}
```

```ts
// test/greet.test.ts
import { expect, it, vi } from 'hypotes';
import { greeting } from '../src/greet.ts';

const { readFileSync } = vi.hoisted(() => ({
    readFileSync: vi.fn(() => 'Ada\n')
}));

vi.mock('node:fs', async importOriginal => ({
    ...(await importOriginal<typeof import('node:fs')>()),
    readFileSync
}));

it('greets the name in the file', () => {
    expect(greeting()).toBe('Hello, Ada!');
    expect(readFileSync).toHaveBeenCalledWith('name.txt', 'utf8');
});
```

## Entry points

### `hypotes`

- `describe` and `suite`, and `it` and `test`, with `.skip`, `.only`,
  `.todo`, `.skipIf()`, `.runIf()`, `.each()` and `.for()`. Their options
  follow the function, as Vitest takes them, or come before it, as node:test
  does: `timeout`, `skip`, `todo`, `only`, and node:test's `concurrency`.
- `beforeAll`, `afterAll`, `beforeEach` and `afterEach`.
- `expect`, with Vitest's matchers and asymmetric matchers, `expect.extend()`
  and `expect.addEqualityTesters()`.
- `vi`, with `fn`, `spyOn`, `mocked`, `isMockFunction`, `clearAllMocks`,
  `resetAllMocks`, `restoreAllMocks`, `mock`, `unmock`, `doMock`, `doUnmock`,
  `hoisted` and `importActual`.

### `hypotes/fast-check`

`it` and `test`, with `it.prop()`, which declares property tests as
`@fast-check/vitest` does, and fast-check's `fc`. A failure reports the shrunk
counterexample, with the seed and path that replay it.

```ts
import { expect } from 'hypotes';
import { fc, it } from 'hypotes/fast-check';

it.prop([fc.array(fc.integer())])('sorts in order', values => {
    const sorted = values.toSorted((a, b) => a - b);
    for (let index = 1; index < sorted.length; index++) {
        expect(sorted[index - 1]).toBeLessThanOrEqual(sorted[index]);
    }
});
```

### `hypotes/oxlint`

Rules for tests, as an oxlint JS plugin, in place of oxlint's vitest rules,
which see only what's imported from `vitest`. These see the tests and suites
declared through `hypotes`, `hypotes/fast-check` and `node:test`, and the
assertions of hypotes' `expect`. Load them in `.oxlintrc.json`:

```json
{
    "jsPlugins": ["hypotes/oxlint"],
    "rules": {
        "hypotes/expect-expect": "error",
        "hypotes/no-standalone-expect": "error",
        "hypotes/valid-expect": "error",
        "hypotes/prefer-to-be": "error",
        "hypotes/prefer-to-have-length": "error"
    }
}
```

- `expect-expect`: each test calls `expect()`, or a function whose name starts
  with `expect`.
- `no-standalone-expect`: `expect()` runs in a test, or in a function of its
  own, rather than in a describe block or at the top of a module.
- `valid-expect`: a matcher is called on `expect()`, and the promise of
  `.resolves` or `.rejects` is awaited or returned.
- `prefer-to-be`: `toBe()` of a primitive, rather than `toEqual()` or
  `toStrictEqual()`, and `toBeNull()`, `toBeUndefined()`, `toBeDefined()` and
  `toBeNaN()`, rather than comparisons with those values. `--fix` fixes it.
- `prefer-to-have-length`: `expect(values).toHaveLength(n)`, rather than
  comparing `values.length` with `n`. `--fix` fixes it.

### `hypotes/register`

The preload that mocks modules, which [Install and run](#install-and-run)
describes.

## Left out

hypotes leaves these members of Vitest's API out, some of which node:test
has in another form:

| Left out                                                                          | Instead                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `it.concurrent`, `describe.concurrent`                                            | The `concurrency` option, as in `describe('name', { concurrency: true }, fn)` |
| `it.sequential`, `describe.sequential`                                            | None: a file's tests run one at a time, unless `concurrency` says otherwise   |
| `it.fails`, `it.extend`, `describe.shuffle`                                       | None                                                                          |
| `expect.soft`, `expect.poll`, `expect.assertions`, `expect.hasAssertions`         | None                                                                          |
| `expect.unreachable`                                                              | `assert.fail()`, from `node:assert`                                           |
| `toMatchSnapshot` and the other snapshot matchers, `expect.addSnapshotSerializer` | node:test's `t.assert.snapshot()`                                             |
| `vi.useFakeTimers`, `vi.setSystemTime` and the other members for timers           | node:test's `mock.timers`                                                     |
| `vi.stubGlobal`                                                                   | node:test's `mock.property()`, for a global that exists                       |
| `vi.stubEnv`, `vi.resetModules`, `vi.waitFor`, `vi.waitUntil`                     | None                                                                          |
| `vi.importMock`, `vi.mockObject`, automocking, `__mocks__` directories            | A factory, as in `vi.mock(path, factory)`                                     |

## Differences from Vitest

### Tests and hooks

- A test's function gets node:test's context, such as `t.mock` and
  `t.assert`, rather than Vitest's, which has `expect` and `task`.
- `.only` runs a test alone only with `--test-only`, or when its file runs in
  one process, as with `node file.test.ts`.
- `.todo` with a function runs it, and reports its failure without failing
  the run, where Vitest doesn't run it.
- After hooks, and the cleanups that `beforeAll` and `beforeEach` return, run
  in the order that they were declared, where Vitest runs them in reverse.
- A hook at the top of a file runs for every test in the process: those of
  the file, unless tests run in one process, with `--test-isolation=none`.

### Equality

`toEqual` and `toStrictEqual` compare arrays and typed arrays by their
elements alone, and objects by their string keys: properties set on an array
besides its elements, and symbol keys, don't make two values differ, as they
do in Vitest.

### Module mocks

`hypotes/register` hoists the mocks of each ES module outside `node_modules`
that calls `vi.mock()`, as Vitest's transform does, but:

- The module's imports become constants: a binding that its module reassigns
  keeps the value that it had when it was imported, rather than being live.
- The factories of its mocks all run before its imports and dynamic imports,
  even for modules that are never imported, rather than as each mocked module
  loads.
- It can't `export * from` another module, which would load before the mocks.
  It can export by name, or with `export * as`.
- `vi.mock()`, `vi.unmock()` and `vi.hoisted()` must each be a statement of
  its own, at the top level of the module. The statement can declare what
  `vi.hoisted()` returns, but nothing else.
- `vi` must be imported from `hypotes`, as `vi`. A CommonJS module can't call
  `vi.mock()`.
- A mock lasts for the rest of the process, unless `vi.doUnmock()`, or
  disposing what `vi.doMock()` returns, ends it. With `--test-isolation=none`,
  test files share a process, and a mock leaks into the files after the one
  that made it.
- Mocks apply to `require()`, and to modules in `node_modules`, which
  Vitest's don't: mocking `node:fs` changes what a CommonJS dependency gets
  from `require('node:fs')`. `require()` of a mocked CommonJS package returns
  the mock's namespace, `{ default }`, rather than its default export.

## Failure output

node:test's reporters don't print the diff that Vitest's does, so a failed
matcher that compares values carries one in its message:

```text
✖ compares a user (1.534167ms)
  Error [AssertionError]: expected { name: 'Ada', …(2) } to deeply equal { name: 'Ada', …(2) }

  + actual - expected

  + { age: 36, name: 'Ada', roles: [ 'admin', 'dev' ] }
  - { age: 36, name: 'Ada', roles: [ 'admin' ] }
```

Messages have colours only where Node prints them: to a terminal, or with
`FORCE_COLOR`, but not to a file or a pipe.
