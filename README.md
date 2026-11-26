# hypotes

Vitest's API on Node's test runner. Same tests, no Vite.

Tests written with `describe`, `it`, `expect` and `vi` from hypotes run with
`node --test`. There is no bundler and no config file, and node:test stays
the runner: Node runs the test files as they are, and node:test's reporters,
watch mode and coverage apply to them. The
[`hypotes` command](#the-hypotes-command) is a shorter way to call it. It runs
TypeScript by [stripping its
types](https://nodejs.org/api/typescript.html#type-stripping), so a test file,
and what it imports, has to run on Node as it's written.

Use hypotes when you want Vitest's matchers, spies, module mocks and fake
timers, but node:test as the runner. A test file that uses what both have
moves between Vitest and hypotes by changing its imports. If you need what
only Vitest has, such as snapshots, browser mode or Vite's transforms, use
Vitest: [Left out](#left-out) lists what hypotes doesn't have.

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

To run other files, name them, as in `node --test "**/*.spec.ts"`. Or run
[the `hypotes` command](#test-files), which runs the files that Vitest does.

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

Without a factory, `vi.mock()` mocks the module's exports by itself, as
Vitest does. Functions become mocks that return `undefined`. Classes,
objects and arrays are mocked deeply, as
[Vitest's guide](https://vitest.dev/guide/mocking/modules) describes:

```ts
// test/greet-automock.test.ts
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'hypotes';
import { greeting } from '../src/greet.ts';

vi.mock('node:fs');

it('greets the name that the mock returns', () => {
    vi.mocked(readFileSync).mockReturnValue('Ada\n');

    expect(greeting()).toBe('Hello, Ada!');
});
```

With `vi.mock(path, { spy: true })`, the mocks keep their implementations,
and record their calls.

Module mocks differ from Vitest's in a few ways, which
[Module mocks](#module-mocks) under the differences lists.

## TypeScript that Node doesn't strip

Node strips types, but rejects TypeScript that needs compiling, such as
enums, namespaces and parameter properties:

```text
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
```

[`@snovader/node-hooks`](https://www.npmjs.com/package/@snovader/node-hooks)
strips types with oxc instead, which compiles them. Its README says how else
it differs from Node's stripping. hypotes' module mocks work with it.

1. Install it:

   ```bash
   npm install --save-dev @snovader/node-hooks
   ```

2. Write a module that Node can't strip, as `src/direction.ts`:

   ```ts
   export enum Direction {
       Up = 'up',
       Down = 'down'
   }
   ```

   And its test, as `test/direction.test.ts`:

   ```ts
   import { expect, it } from 'hypotes';
   import { Direction } from '../src/direction.ts';

   it('reads an enum', () => {
       expect(Direction.Up).toBe('up');
   });
   ```

3. Run the tests with both preloads, and with source maps:

   ```bash
   node --enable-source-maps --import hypotes/register --import @snovader/node-hooks/register --test
   ```

   ```text
   ✔ reads an enum (0.699208ms)
   ✔ greets the name in the file (1.082625ms)
   ℹ tests 2
   ℹ suites 0
   ℹ pass 2
   ℹ fail 0
   ℹ cancelled 0
   ℹ skipped 0
   ℹ todo 0
   ℹ duration_ms 359.02475
   ```

   Without module mocks, leave out `--import hypotes/register`. With them,
   the two preloads work in either order.

oxc prints the code anew, so its lines aren't the file's. node-hooks maps
them back only with `--enable-source-maps`. Without it, node:test reports
where tests are declared, and stack traces where they fail, at the wrong
lines.

node-hooks' README suggests `--no-strip-types`. With it, `node --test`
doesn't look for `.ts` files, so name them, as in
`node --test "test/**/*.test.ts"`.

If you register node-hooks' resolution cache yourself, register it before
`hypotes/register`, so that it runs after it. Run before it, the cache keeps
the first resolution of each module. `vi.doMock()` then can't mock a module
that was imported before, and mocks of built-in modules don't apply.

## Moving a test file from Vitest

1. Import from `hypotes` what the file imports from `vitest`, and from
   `hypotes/fast-check` what it imports from `@fast-check/vitest`. hypotes
   defines no globals, so a file that relied on Vitest's `globals` option
   imports what it uses.
2. Check that Node runs the file, and what it imports, without Vite. Imports
   name their files with the extension, as `./sum.ts`. Enums, path aliases
   and JSX don't run, and neither does what Vite's plugins add.
   [Type stripping](https://nodejs.org/api/typescript.html#type-stripping),
   in Node's documentation, says what does. For enums, see
   [TypeScript that Node doesn't strip](#typescript-that-node-doesnt-strip).
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
- `vi`, with these members:
  - For spies: `fn`, `spyOn`, `mockObject`, `mocked`, `isMockFunction`,
    `clearAllMocks`, `resetAllMocks` and `restoreAllMocks`.
  - For module mocks: `mock`, `unmock`, `doMock`, `doUnmock`, `hoisted`,
    `importActual` and `importMock`.
  - For fake timers: `useFakeTimers`, `useRealTimers`, `isFakeTimers`,
    `advanceTimersByTime`, `advanceTimersByTimeAsync`,
    `advanceTimersToNextTimer`, `advanceTimersToNextTimerAsync`,
    `advanceTimersToNextFrame`, `runAllTimers`, `runAllTimersAsync`,
    `runOnlyPendingTimers`, `runOnlyPendingTimersAsync`, `runAllTicks`,
    `getTimerCount`, `clearAllTimers`, `setSystemTime`,
    `getMockedSystemTime`, `getRealSystemTime` and `setTimerTickMode`.
  - For globals and environment variables: `stubGlobal`, `unstubAllGlobals`,
    `stubEnv` and `unstubAllEnvs`.
  - For waiting: `waitFor` and `waitUntil`.

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

### `hypotes/cli`

The module of [the `hypotes` command](#the-hypotes-command), which runs as
it's imported. Run the command instead.

### `hypotes/reporter`

A reporter for node:test that prints a row for each test file, with the name
of its package, which [Reporter](#reporter) describes.

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
| `vi.resetModules`                                                                 | None                                                                          |
| `__mocks__` directories                                                           | A factory, as in `vi.mock(path, factory)`                                     |

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
- **Timeouts.** Under `node --test`, a test or a hook has no timeout unless
  it's given one. Vitest fails a test after 5 seconds, and a hook after 10.
  Node's `--test-timeout` sets one for every test and hook, and
  [the `hypotes` command](#timeout) passes Vitest's 5 seconds.

### Equality

`toEqual` and `toStrictEqual` compare arrays and typed arrays by their
elements alone, and objects by their string keys. So do the matchers that
compare as `toEqual` does, such as `toContainEqual`, `toHaveProperty` and
`toHaveBeenCalledWith`. Two things that make values differ in Vitest are
ignored: properties set on an array besides its elements, and symbol keys.

### Fake timers, stubs and waits

The timers are Vitest's, on the version of
[`@sinonjs/fake-timers`](https://github.com/sinonjs/fake-timers) that Vitest
has, and take the options of
[`vi.useFakeTimers()`](https://vitest.dev/api/vi#vi-usefaketimers).
node:test's `mock.timers` is another clock, so a test fakes the timers with
one of the two.

- **Options.** Vitest reads the default options from `fakeTimers` in its
  configuration. hypotes has no configuration, so each call of
  `vi.useFakeTimers()` passes the options that it changes.
- **Nothing is undone between tests.** Vitest's `unstubGlobals` and
  `unstubEnvs` options undo the stubs after each test. Here an `afterEach`
  calls `vi.unstubAllGlobals()` and `vi.unstubAllEnvs()`, and
  `vi.useRealTimers()` as in Vitest. With `--test-isolation=none`, test
  files share a process, so fake timers and stubs that a file leaves stay
  for the files that run after it.
- **A clock that moves by itself keeps a test file running.** With
  `shouldAdvanceTime`, or a tick mode besides `manual`, the fake clock moves
  on a real timer. node:test waits for it, so a file that leaves such a
  clock on never ends. Call `vi.useRealTimers()` in an `afterEach` or an
  `afterAll`. Vitest ends the file's worker instead, so the file ends there
  without it.
- **`process.nextTick`.** `toFake: ['nextTick']` fakes it. Vitest throws
  instead in its default pool, `forks`.
- **`import.meta.env`.** `vi.stubEnv()` changes `process.env`. Vitest changes
  `import.meta.env` too, which Vite defines and Node doesn't.
- **A wait ends when it settles.** In Vitest, a `vi.waitUntil()` whose
  function throws on its first call keeps calling the function until its
  timeout, and moves fake timers forward each time, in later tests too.
  hypotes stops calling it.

### Module mocks

`hypotes/register` hoists the mocks of each ES module outside `node_modules`
that calls `vi.mock()`, as Vitest's transform does. It differs in these ways:

- **Imports aren't live.** The module's imports become constants. If the
  module that exports a binding reassigns it, the importer keeps the value
  from when it was imported.
- **Factories run early.** All of a module's mock factories run before its
  imports and dynamic imports, even for modules that are never imported.
  Vitest runs each as its mocked module loads.
- **Originals load early.** A mock without a factory loads the original at
  the same time, to mock its exports. So the original's top-level code runs
  even if the mocked module is never imported.
- **No cycles through a mock without a factory.** If the original imports a
  module that imports the mocked module back, the import fails with an error
  that says so. Vitest gives such a module the mock's exports as they're
  made. Give the mock a factory instead.
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

## The `hypotes` command

`hypotes` runs `node --test` with hypotes' preload and reporter, and with
Vitest's defaults for the test files, the timeout, and how a test file
ends. It passes its other arguments on. These two commands do the same:

```bash
npx hypotes
```

```bash
node --import hypotes/register --test --test-reporter=hypotes/reporter --test-timeout=5000 --test-force-exit "**/*.{test,spec}.?(c|m)[jt]s?(x)"
```

node:test's flags work as they do with `node --test`, as in
`npx hypotes --watch`. With `--test-reporter`, node:test uses that reporter
rather than [hypotes' own](#reporter). The command exits as Node does: with
1 if a test fails.

A flag takes its value after `=`. Write `--test-name-pattern=adds`, not
`--test-name-pattern adds`: the command takes an argument without a leading
`-` for a file or a pattern of files. Node then fails, as the flag has no
value, with `--test-name-pattern requires an argument`.

After a `--`, each argument is a file or a pattern, as in Node.

### Test files

Named no files, the command runs those that match Vitest's default
[`include`](https://vitest.dev/config/include), outside `node_modules`:

```text
**/*.{test,spec}.?(c|m)[jt]s?(x)
```

So it runs `sum.test.ts` and `sum.spec.js`, in any directory. It doesn't run
the other files of a `test` directory, such as helpers, which `node --test`
does. In `package.json`, the script is the command alone:

```json
{
    "scripts": {
        "test": "hypotes"
    }
}
```

A file or a pattern takes the place of the default, so
`npm test -- test/sum.test.ts` runs that file alone.

- **`.jsx` and `.tsx`.** The pattern has them, as Vitest's does, but Node
  doesn't run them by itself. They need a preload of your own that does,
  passed with `--import`.
- **`--no-strip-types`.** The pattern has `.ts`, `.mts` and `.cts` then
  too, which Node can't run without stripping types, so those files fail.
  Name a pattern of your own, such as `"**/*.test.js"`.
- **No test files.** If nothing matches, node:test runs no tests and the
  command exits with 0. Vitest fails.

### Timeout

The command passes `--test-timeout=5000`, Vitest's default of 5 seconds.
Without it, a test that never ends holds a CI job until the job's own limit.
A `--test-timeout` of your own takes its place, as in
`npx hypotes --test-timeout=30000`.

- **Hooks have the same timeout.** node:test gives the timeout to hooks too,
  so a hook fails after 5 seconds. In Vitest, a hook has 10. Give a slow
  hook its own, as in `beforeAll(fn, 10_000)`.
- **A timeout fails the test, but doesn't end what it started.** A timer or
  a server that the test left running goes on. The command ends the file's
  process anyway, as [the next section](#what-a-test-leaves-running) says.

### What a test leaves running

The command passes Node's
[`--test-force-exit`](https://nodejs.org/api/cli.html#--test-force-exit).
node:test then ends each file's process once its tests and hooks are done,
as Vitest ends a file's worker. Without it, a timer, a server, or an open
connection that a test left behind keeps the process alive, and holds a CI
job until the job's own limit, even after the test has timed out.

- **A leak passes unseen.** A test that leaves something running passes,
  and nothing says so. To find such tests, run
  `npx hypotes --no-test-force-exit`: the run then waits for them.
- **Work that isn't awaited is cut off.** What a test starts and doesn't
  wait for, such as a write to a file, may not finish. Await it in the test
  or in a hook.
- **`--watch`.** Node refuses `--test-force-exit` together with `--watch`,
  so the command leaves it out under `--watch`.
  It doesn't see a `watch` in
  [Node's configuration file](#nodes-configuration-file), so pass
  `--watch` to the command instead.

### Node's configuration file

Node reads a `node.config.json` when it's given `--config-file`, which the
command passes on, as in `npx hypotes --config-file`. Before Node 26.12, the
flag is `--experimental-config-file`. Node's
[documentation](https://nodejs.org/api/cli.html) has what the file takes.

The file's settings reach node:test as they do under `node --test`, but for
three, which the command passes flags of its own for:

- **`test-timeout`.** The command's 5 seconds take its place, since a flag
  overrides the file. Pass `--test-timeout` to the command instead.
- **`test-reporter`.** Node adds the file's reporter to the command's, and
  fails: it then wants a `--test-reporter-destination` for each. Leave the
  reporter out of the file, and pass `--test-reporter` to the command
  instead.
- **`test-force-exit`.** The command's flag takes its place. Pass
  `--no-test-force-exit` to the command instead.

### Running one project

In a repository of several packages, `--project` runs the test files of one
of them, by the `name` in its `package.json`, as Vitest's `--project` does:

```bash
npx hypotes --project @shop/web
```

```text
 ✓ |@shop/web| test/cart.test.js (1 test) 1ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  131ms
```

A file is in the project that [the reporter](#reporter) prints for it: the
nearest `package.json` above it that has a `name`.

| Command                                             | Runs the test files of                |
| --------------------------------------------------- | ------------------------------------- |
| `hypotes --project @shop/web`                       | `@shop/web`                           |
| `hypotes --project @shop/web --project @shop/api`   | Both                                  |
| `hypotes --project "@shop/*"`                       | Each project whose name starts so     |
| `hypotes --project "!@shop/web"`                    | Each project but `@shop/web`          |
| `hypotes --project @shop/web "**/*.spec.js"`        | `@shop/web`, among those of a pattern |

node:test can't select files by their package, so with `--project` the
command names each selected project's directory to node:test, as a pattern.
node:test then finds the test files in it, by the same
[pattern](#test-files) as without `--project`.

- **Names match in any case.** `--project "@SHOP/web"` selects
  `@shop/web`, as it does in Vitest.
- **No project matches.** The command fails, and lists the projects that it
  found.

In two cases a directory's pattern would take in files of other projects,
so the command finds the project's files itself and names them one by one:

- with a pattern of your own, as in the last row of the table;
- for a project with another package inside its directory that isn't
  selected, such as the root package of a repository.

That has costs:

- **`--watch` watches the files that it found.** A test file added later
  runs after a restart.
- **A command can only be so long.** Each file is an argument to Node.
  macOS and Linux take about a megabyte of them, and Windows 32,767
  characters, which a few hundred files can exceed. The command then fails,
  and says so. Select fewer files, or select the packages inside the
  project too.

## Reporter

node:test's `spec` reporter prints each test, but not the file or the package
that it is in. In a repository of several packages, that makes a result hard
to place. `hypotes/reporter` prints a row for each test file instead, with
its project, as Vitest's default reporter does.

Pass it to node:test, from the root of the repository:

```bash
node --test --test-reporter=hypotes/reporter
```

With a test file in each of two packages, `@shop/api` and `@shop/web`, it
prints:

```text
 ✓ |@shop/api| test/price.test.js (2 tests) 1ms
 ✓ |@shop/web| test/cart.test.js (1 test) 1ms

 Test Files  2 passed (2)
      Tests  3 passed (3)
   Duration  138ms
```

A file's project is the nearest `package.json` above it that has a `name`.
The file's path is from that package's directory. A file with no such
package above it has no project, and its path is from the working directory.

A file with a failure lists its failed tests. Their errors follow the files,
each under its file and the titles of its suites:

```text
 ❯ |@shop/api| test/price.test.js (2 tests | 1 failed) 2ms
   × price > rounds up 1ms
 ✓ |@shop/web| test/cart.test.js (1 test) 1ms

 Failed Tests 1

 FAIL |@shop/api| test/price.test.js > price > rounds up
Error [AssertionError]: expected 3 to be 2 // Object.is equality
```

A file that fails as it loads, and a suite whose hook fails, aren't tests.
Their errors come first, under `Failed Suites`.

The error is printed as node:test's reporters print it, with its stack.

- **Colours.** Where Node prints colours, a project's name is on a coloured
  background rather than between bars.
- **Other output.** What tests write to stdout and stderr, their
  diagnostics, and the coverage report are printed as `spec` prints them.
  The totals take the place of node:test's own.
- **Any node:test tests.** The reporter reads node:test's results, so it
  reports tests declared with `node:test` too. It doesn't need
  `hypotes/register`, and works with it.
- **When a row appears.** node:test reports a file's results in the order
  that the files were found. A file's row is printed once the next file's
  results start, so the row of a slow file holds back those after it.
- **Tests that a helper declares.** With `--test-isolation=none`, node:test
  doesn't say which test file a test is from, only where it was declared.
  Node 24.13.1 doesn't say it with any isolation. A test that a helper in
  another module declares, as a rule tester does, is then reported under
  that module, in a row of its own, which counts as a file in the totals.
- **No `--project`.** The reporter names projects, but doesn't select them.
  [The `hypotes` command](#running-one-project) does.

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
| `require-mock-type-parameters` | `vi.fn()` without an implementation is given the type that it mocks, in TypeScript.       |

## License

[MIT](LICENSE)
