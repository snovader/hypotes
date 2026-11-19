# hypotes

Vitest's API on Node's test runner. Same tests, no Vite.

Tests written with `describe`, `it`, `expect` and `vi` from hypotes run with
`node --test`. There is no bundler, no config file and no second runner: Node
runs the test files as they are, and node:test's reporters, watch mode and
coverage apply to them. It runs TypeScript by
[stripping its types](https://nodejs.org/api/typescript.html#type-stripping),
so a test file, and what it imports, has to run on Node as it's written.

Use hypotes when you want Vitest's matchers, spies and module mocks, but
node:test as the runner. A test file that uses what both have moves between
Vitest and hypotes by changing its imports. If you need what only Vitest
has, such as snapshots, browser mode or Vite's transforms, use Vitest:
[Left out](#left-out) lists what hypotes doesn't have.

hypotes needs Node 24.13.1 or later.

## Quick start

Install it:

```bash
npm install --save-dev hypotes
```

The examples are ES modules, so the project's `package.json` needs
`"type": "module"`. With `"type": "commonjs"`, which npm 11's `npm init`
writes, Node rejects their `import` statements. Without a `type`, it runs
them, but warns about each test file.

Write a test, as `test/sum.test.ts`:

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
        const callback = vi.fn<(value: number) => void>();
        [1, 2].forEach(callback);
        expect(callback).toHaveBeenCalledTimes(2);
    });
});
```

Run it:

```bash
node --test
```

```text
▶ sum
  ✔ adds numbers (0.451ms)
  ✔ 1 + 1 = 2 (0.072875ms)
  ✔ 2 + 3 = 5 (0.047792ms)
  ✔ calls back (0.352ms)
✔ sum (1.49425ms)
ℹ tests 4
ℹ suites 1
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 181.809417
```

That is all that tests without module mocks need. `node --test` takes
[its own options](https://nodejs.org/api/test.html), such as `--watch`.

It runs the files that
[node:test looks for](https://nodejs.org/api/test.html#running-tests-from-the-command-line),
which aren't the ones that Vitest runs:

- It runs `*.test.ts`, and every `.ts` and `.js` file in a `test` directory,
  helpers and fixtures included. Vitest runs only `*.test.ts` and
  `*.spec.ts` there.
- It doesn't run `*.spec.ts` outside a `test` directory, which Vitest does.

To run other files, name them, as in `node --test "**/*.spec.ts"`.

## Mocking modules

`vi.mock()` needs two more things: a preload, and two packages that the
preload uses to hoist the mocks.

Install the packages:

```bash
npm install --save-dev oxc-parser magic-string
```

Run the tests with the preload, `hypotes/register`:

```bash
node --import hypotes/register --test
```

node:test passes the preload on to the process of each test file. It can
come from `NODE_OPTIONS` instead:

```bash
NODE_OPTIONS='--import hypotes/register' node --test
```

Only test files that mock modules need the preload, and it does no harm to
the others. Without it, `vi.mock()` and `vi.doMock()` throw an error that
names it.

A mock is written as for Vitest, here with `vi.hoisted()` and
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
    readFileSync: vi.fn<(path: string, encoding: string) => string>(
        () => 'Ada\n'
    )
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

Module mocks differ from Vitest's in a few ways, which
[Module mocks](#module-mocks) under the differences lists.

## Moving a test file from Vitest

1. Import from `hypotes` what the file imports from `vitest`, and from
   `hypotes/fast-check` what it imports from `@fast-check/vitest`. hypotes
   defines no globals, so a file that relied on Vitest's `globals` option
   imports what it uses.
2. Check that Node runs the file, and what it imports, without Vite. Imports
   name their files with the extension, as `./sum.ts`. Enums, path aliases
   and JSX don't run, and neither does what Vite's plugins add.
   [Type stripping](https://nodejs.org/api/typescript.html#type-stripping),
   in Node's documentation, says what does.
3. Run it with `node --test`, which
   [runs other files](#quick-start) than Vitest does. If it mocks modules,
   set up [the preload](#mocking-modules) first.
4. Replace what [Left out](#left-out) lists. The table names what node:test
   has instead.
5. Read [Differences from Vitest](#differences-from-vitest) for behaviour that
   changes without an error, such as the order of after hooks, and tests
   that have no timeout.
6. If the project lints its tests with oxlint's vitest rules, switch to
   [`hypotes/oxlint`](#lint-rules).

## Entry points

What hypotes has works as [Vitest's API](https://vitest.dev/api/) documents
it, apart from the differences below.

### `hypotes`

- `describe` and `suite`, and `it` and `test`, with `.skip`, `.only`,
  `.todo`, `.skipIf()`, `.runIf()`, `.each()` and `.for()`.
- Options for a test or a suite: `timeout`, `skip`, `todo`, `only`, and
  node:test's `concurrency`. They come before the function, as in
  `it('name', { timeout: 100 }, fn)`. A timeout alone can follow it, as in
  `it('name', fn, 100)`.
- `beforeAll`, `afterAll`, `beforeEach` and `afterEach`.
- `expect`, with Vitest's matchers and asymmetric matchers,
  `expect.extend()`, `expect.addEqualityTesters()` and `expect.fail()`.
- `vi`, with these members: `fn`, `spyOn`, `mocked`, `isMockFunction`,
  `clearAllMocks`, `resetAllMocks`, `restoreAllMocks`, `mock`, `unmock`,
  `doMock`, `doUnmock`, `hoisted` and `importActual`.

### `hypotes/fast-check`

Property tests, declared with `it.prop()` as `@fast-check/vitest` declares
them. It exports `it`, `test`, and fast-check's `fc`. A failure reports the
shrunk counterexample, with the seed and path that replay it.

It needs fast-check:

```bash
npm install --save-dev fast-check
```

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

Lint rules for tests, as an oxlint JS plugin, which
[Lint rules](#lint-rules) describes.

### `hypotes/register`

The preload that module mocks need, which [Mocking modules](#mocking-modules)
describes.

## Left out

hypotes leaves out these members of Vitest's API. node:test has some of them
in another form. Of `vi`, hypotes has only the members that
[`hypotes`](#hypotes) lists.

| Left out                                                                          | Instead                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `it.concurrent`, `describe.concurrent`                                            | The `concurrency` option, as in `describe('name', { concurrency: true }, fn)` |
| `it.sequential`, `describe.sequential`                                            | None: a file's tests run one at a time, unless `concurrency` says otherwise   |
| `it.fails`, `it.extend`, `describe.shuffle`                                       | None                                                                          |
| The `retry`, `repeats` and `tags` options                                         | None                                                                          |
| `onTestFinished`                                                                  | `t.after()`, on node:test's context                                           |
| `onTestFailed`, `aroundEach`, `aroundAll`, `inject`                               | None                                                                          |
| `expect.soft`, `expect.poll`, `expect.assertions`, `expect.hasAssertions`         | None                                                                          |
| `expect.unreachable`                                                              | `expect.fail()`                                                               |
| `toMatchSnapshot` and the other snapshot matchers, `expect.addSnapshotSerializer` | node:test's `t.assert.snapshot()`                                             |
| `expectTypeOf`, `assertType`                                                      | The `expect-type` package, which Vitest's `expectTypeOf` comes from           |
| `assert`, `chai`, `should`                                                        | The `chai` package, which Vitest's come from                                  |
| `vi.useFakeTimers`, `vi.setSystemTime` and the other members for timers           | node:test's `mock.timers`                                                     |
| `vi.stubGlobal`                                                                   | node:test's `mock.property()`, for a global that exists                       |
| `vi.stubEnv`, `vi.resetModules`, `vi.waitFor`, `vi.waitUntil`                     | None                                                                          |
| `vi.importMock`, `vi.mockObject`, automocking, `__mocks__` directories            | A factory, as in `vi.mock(path, factory)`                                     |

## Differences from Vitest

### Tests and hooks

- **Context.** A test's function gets node:test's context, with `t.mock` and
  `t.assert`. Vitest's has `expect` and `task`.
- **`.only`.** Under `node --test`, `.only` does nothing unless `--test-only`
  is passed too. It does apply when a file is run by itself, as
  `node file.test.ts`.
- **`.todo`.** A `.todo` test that has a function runs. Its failure is
  reported, but doesn't fail the run. Vitest doesn't run it.
- **Order of after hooks.** After hooks run in the order that they were
  declared. So do the cleanups that `beforeAll` and `beforeEach` return.
  Vitest runs both in reverse.
- **Hooks at the top of a file.** Such a hook runs for every test in the
  process. node:test runs each file in a process of its own, so that means
  the file's tests, as in Vitest. With `--test-isolation=none`, the files
  share one process, and the hook runs for the tests of them all.
- **Timeouts.** A test or a hook has no timeout unless it's given one. Vitest
  fails a test after 5 seconds, and a hook after 10. Node's `--test-timeout`
  sets one for every test.

### Equality

`toEqual` and `toStrictEqual` compare arrays and typed arrays by their
elements alone, and objects by their string keys. So do the matchers that
compare as `toEqual` does, such as `toContainEqual`, `toHaveProperty` and
`toHaveBeenCalledWith`. Two things that make values differ in Vitest are
ignored: properties set on an array besides its elements, and symbol keys.

### Module mocks

`hypotes/register` hoists the mocks of each ES module outside `node_modules`
that calls `vi.mock()`, as Vitest's transform does. It differs in these ways:

- **Imports aren't live.** The module's imports become constants. If the
  module that exports a binding reassigns it, the importer keeps the value
  from when it was imported.
- **Factories run early.** All of a module's mock factories run before its
  imports and dynamic imports, even for modules that are never imported.
  Vitest runs each as its mocked module loads.
- **No `export * from`.** A module that calls `vi.mock()` can't
  `export * from` another module, which would load before the mocks. It can
  export by name, or with `export * as`.
- **Top-level statements.** `vi.mock()`, `vi.unmock()` and `vi.hoisted()`
  must each be a statement of its own, at the top level of the module. The
  statement can declare what `vi.hoisted()` returns, but nothing else.
- **`vi` by name.** `vi` must be imported from `hypotes`, as `vi`.
- **No CommonJS.** A CommonJS module can't call `vi.mock()`.
- **Mocks last.** A mock lasts for the rest of the process. `vi.doUnmock()`
  ends it, and so does disposing what `vi.doMock()` returns. With
  `--test-isolation=none`, test files share a process, so a mock leaks into
  the files that run after the one that made it.
- **`require()` and dependencies.** A mock applies wherever the module is
  loaded in the process: by `require()` too, and by the packages in
  `node_modules`, when they import it. Vitest's mocks reach neither. Mocking
  `node:fs` changes what a CommonJS dependency gets from
  `require('node:fs')`. `require()` of a mocked CommonJS package returns the
  mock's namespace, `{ default }`, rather than its default export.

## Failure output

node:test's reporters print an error's message, its stack, and its `actual`
and `expected` values, but not the diff that Vitest's does. So a failed
matcher that compares values carries the diff in its message, which the
report starts with:

```text
✖ compares a user (1.534167ms)
  Error [AssertionError]: expected { name: 'Ada', …(2) } to deeply equal { name: 'Ada', …(2) }

  + actual - expected

  + { age: 36, name: 'Ada', roles: [ 'admin', 'dev' ] }
  - { age: 36, name: 'Ada', roles: [ 'admin' ] }
```

Messages have colours only where Node prints them: to a terminal, or with
`FORCE_COLOR`, but not to a file or a pipe.

## Lint rules

`hypotes/oxlint` has lint rules for tests, as an
[oxlint](https://oxc.rs/docs/guide/usage/linter) JS plugin. oxlint's own
vitest rules see only what a file imports from `vitest`, so these take their
place. They see the tests and suites declared through `hypotes`,
`hypotes/fast-check` and `node:test`, the assertions of hypotes' `expect`,
and hypotes' `vi`.

Load them in `.oxlintrc.json`, with the rules that you want:

```json
{
    "jsPlugins": ["hypotes/oxlint"],
    "rules": {
        "hypotes/no-focused-tests": "error",
        "hypotes/no-disabled-tests": "warn",
        "hypotes/warn-todo": "warn",
        "hypotes/no-conditional-tests": "error",
        "hypotes/valid-title": "error",
        "hypotes/valid-describe-callback": "error",
        "hypotes/expect-expect": "error",
        "hypotes/no-standalone-expect": "error",
        "hypotes/valid-expect": "error",
        "hypotes/valid-expect-in-promise": "error",
        "hypotes/require-to-throw-message": "error",
        "hypotes/prefer-to-be": "error",
        "hypotes/prefer-to-have-length": "error",
        "hypotes/hoisted-apis-on-top": "error",
        "hypotes/require-mock-type-parameters": "error"
    }
}
```

The rules take no options. Those marked "fix" are fixed by `--fix`.

Rules for how tests are declared:

| Rule                      | What it checks                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `no-focused-tests`        | No `.only`, and no `only` option.                                                      |
| `no-disabled-tests`       | No `.skip`, no `skip` option, and no test without a function.                          |
| `warn-todo`               | No `.todo`, and no `todo` option.                                                      |
| `no-conditional-tests`    | No test or suite declared in an `if` statement. `skipIf()` and `runIf()` do that.      |
| `valid-title`             | A title has text, no spaces around it, and doesn't start with `it` or `describe`. Fix. |
| `valid-describe-callback` | A suite's function is written in place, and returns nothing. It takes no parameters.   |

Rules for assertions:

| Rule                       | What it checks                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `expect-expect`            | Each test calls `expect()`, or a function whose name starts with `expect`.                |
| `no-standalone-expect`     | `expect()` runs in a test or in a function, not in a suite or at the top of a module.     |
| `valid-expect`             | A matcher is called on `expect()`, and `.resolves` or `.rejects` is awaited or returned.  |
| `valid-expect-in-promise`  | A promise whose callback calls `expect()`, as in `.then()`, is awaited or returned.       |
| `require-to-throw-message` | `toThrow()` and `toThrowError()` say what the error should be, unless they follow `.not`. |
| `prefer-to-be`             | `toBe()` for a primitive, and `toBeNull()` and its like, rather than `toEqual()`. Fix.    |
| `prefer-to-have-length`    | `expect(values).toHaveLength(n)`, rather than comparing `values.length` with `n`. Fix.    |

Rules for mocks:

| Rule                           | What it checks                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `hoisted-apis-on-top`          | `vi.mock()`, `vi.unmock()` and `vi.hoisted()` are top-level statements, where they hoist. |
| `require-mock-type-parameters` | `vi.fn()` is given the type of the function that it mocks, in TypeScript.                 |

## License

[MIT](LICENSE)
