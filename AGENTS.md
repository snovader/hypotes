# Code and design guidelines

These repository guidelines apply when designing, implementing, reviewing, and
refactoring code. Use judgment about tradeoffs; existing code is evidence of
intent, not a requirement to preserve every detail.

## Responsibilities and architecture

- Give each function, class, and module a clear scope of responsibility.
  For example, `tests.ts` declares tests and suites, `hooks.ts` maps hooks onto
  node:test's, `expect.ts` assembles the matchers, `site.ts` records where
  each test was declared, `mocks.ts` mocks modules, `hoist.ts` hoists the
  mocks of a test file, `timers.ts` fakes timers, `stubs.ts` stubs
  globals, `wait.ts` waits for a function to succeed, `project.ts` finds the
  package that a test file belongs to, `reporter.ts` prints node:test's
  results by file, `project-filter.ts` selects projects by `--project`'s
  patterns, `test-files.ts` finds the test files of the selected projects,
  and `cli.ts` launches Node with them.
- Search for existing implementations and related abstractions before adding
  code. Always consider reusability and where behavior belongs. Keep a helper
  local when its responsibility is local; share it when it has a coherent role
  across callers.
- Use classes for encapsulated state, identity, lifecycle, or meaningful behavior.
  Use functions for stateless operations. Caches can own mutable state when that
  is part of their purpose.
- Introduce interfaces at meaningful boundaries or useful substitution points.
  Inject dependencies directly through constructors or callbacks, as
  `createTestAPI` takes the members that a subpath adds. A hypothetical future
  implementation alone needs stronger justification.
- A stable domain-facing API can justify a thin delegating wrapper, provided its
  purpose is clear. Do not remove such a wrapper merely because it delegates.
- Respect package exports. Keep dependencies consistent with the responsibility
  of the package and consider their runtime costs.

## Functions and readability

- Prefer small, focused functions with intentional names. A single caller does
  not prevent extraction: naming a meaningful operation or clarifying its scope
  is sufficient. Avoid arbitrary function-length limits.
- Use whitespace deliberately to separate logical sections within a function,
  such as preparation, computation, side effects, and the result. Keep closely
  related statements together.
- Avoid chained calls with large inline function bodies. Extract substantial
  callbacks into named functions or methods so the overall operation stays easy
  to follow.
- Review adjacent multiline calls and deeply nested expressions for readability.
  Use blank lines between distinct steps and meaningful intermediate variables
  where they clarify the sequence. Preserve efficient execution when restructuring
  expressions; readability does not require extra copies or traversals.
- Use domain terminology consistently. Comments should explain non-obvious
  constraints, algorithms, units, external behavior, or implementation tradeoffs.
  Document public contracts where callers need that information.

## Encapsulation and API design

- Prefer private fields and method-style accessors, especially when access
  performs computation, validation, caching, or other logic. Use `readonly` where
  the field should not be reassigned. This preference can evolve when language
  features offer a compelling improvement.
- Make construction and conversion intentional, using named factories or
  conversion methods where they clarify semantics.
- Make call sites understandable. Use options objects for related configuration.
- Use types to express contracts, including identifiers, units, and supported
  representations where useful. Follow the existing explicit return types and
  type-only imports at API boundaries.
- Decide failure behavior explicitly for each API. Consider possible inputs,
  who calls it, and how its output will be consumed before choosing exceptions,
  missing values, non-finite results, or fallbacks. Document and test that choice.
- Validate external data at appropriate boundaries and establish internal
  invariants deliberately. Avoid silently replacing invalid results with plausible
  values unless that is the intended contract.
- Don't recheck at runtime what documented usage or the types already
  guarantee. Enforce correctness at the boundary that owns it, such as the
  API's contract.

## Vitest's API on node:test

- hypotes gives tests Vitest's API, and runs them on Node's test runner.
  Where it offers something that Vitest has, match Vitest's names, signatures,
  and behavior, quirks included, so that a test file moves between them
  unchanged. The titles of `.each` and `.for` are formatted exactly as
  Vitest 5.1's runner formats them, for example.
- Build on node:test, rather than reimplementing what it does. Tests, suites,
  and hooks are declared through node:test's, and its reporters, timeouts,
  `skip`, `todo`, and `only` apply to them. `vi` has Vitest's spies.
- Fake timers are an exception: node:test's `mock.timers` can't advance
  timers as promises settle, or count them, which Vitest's
  `advanceTimersByTimeAsync` and `getTimerCount` do. So `timers.ts` has
  Vitest's, on `@sinonjs/fake-timers`, as Vitest's own are. Vitest bundles a
  patched copy of the package, so no `@vitest/*` package has it:
  `package.json` pins the version that Vitest bundles, and a pull request
  that moves Vitest's packages moves it too, after comparing Vitest's patch
  of it with what the header of `timers.ts` says that it makes up for.
  `stubs.ts` has Vitest's stubs of globals and environment variables, and
  `wait.ts` its `vi.waitFor` and `vi.waitUntil`, on the real timers that
  `@vitest/utils` keeps. The members of `vi` that Vitest's return `vi` from
  do so here, through `chain.ts`.
- Module mocks are the exception: node:test's `mock.module` needs a flag that
  NODE_OPTIONS can't pass, and can't keep a module's original exports. So
  `vi.mock` and the members of `vi` that go with it mock modules through
  `module.registerHooks`, in `mocks.ts`, which the preload
  `hypotes/register` installs. It hoists the mocks of each module that calls
  `vi.mock`, as Vitest's transform does, in `hoist.ts`, whose header says
  where it differs: imports become constants, and the factories of mocks run
  before the module's imports and dynamic imports, rather than as the mocked
  module loads. It leaves out automocking and `__mocks__` directories, which
  need a factory instead.
- The transform moves a module's code, so it writes a source map, and
  `callerSite()` reads the position that it maps to. Its stack traces and
  the sites of its tests point where the code is written.
- Reuse Vitest's own packages, `@vitest/expect`, `@vitest/spy`, and
  `@vitest/utils`, rather than reimplementing their matchers, spies, or
  formatting. Their versions move together, which Dependabot's `vitest` group
  keeps.
- `hypotes/reporter` is a reporter for node:test, not a runner: it prints
  the events that node:test reports, a row for each file, with its project,
  in the format of Vitest's default reporter. It counts tests as node:test
  counts them, and has node:test's `spec` format what it doesn't lay out
  itself, the coverage. Its header says which of node:test's events it
  relies on, and why not on the summary of a file. It imports nothing of the
  package's that declares tests, so it reports any node:test run.
- The `hypotes` command, in `cli.ts`, is a launcher, not a runner: it
  starts `node --test` with the preload and the reporter, and passes its
  other arguments on unread, so it doesn't parse node:test's flags or keep a
  list of them. Its one flag is Vitest's `--project`. node:test can't select
  files by their package, so `test-files.ts` finds them with node:test's
  default pattern, which it copies: check it against Node's when Node's
  documentation of it changes. The command ends as Node does, and passes on
  the signals that it gets. Don't add what node:test has a flag for.
- Where node:test makes the behavior differ from Vitest's, document the
  difference in the module that has it, as `hooks.ts` does for the order of
  after hooks and `TestOptions` does for `only`. Leave out what needs Vitest's
  runner, such as `expect.soft` and `expect.assertions`, rather than
  approximating it, and say that it's left out.
- Keep the position of each test's declaration in the test file, where
  reporters print it. A function that a test file calls to declare a test
  calls `callerSite()` directly, and passes the site on, as `.each`, `.for`,
  and `.prop` do. `callerSite()` reads the stack at a fixed depth, so calling
  it from a helper reports the wrong site.
- node:test's reporters don't print the diffs that Vitest's does, so a failed
  matcher that compares values carries one in its message. Make a failure
  readable from the message alone. They print a message as it is, to a file
  too, so `expect.ts` turns off the colours of `@vitest/expect`'s messages
  where Node prints none.
- The equality tester in `equals.ts` answers with the result that
  `@vitest/expect`'s `equals` would give, or with undefined to leave the values
  to it. It differs only where its header says: it ignores the properties of
  an array or a typed array besides its elements, and symbol keys. A faster path that changes
  another result is a bug; the property tests in `test/equals.test.ts`
  compare the two.
- The oxlint rules in `source/oxlint` recognize the API that test files call.
  A change to how tests, suites, or assertions are declared, such as a new
  modifier or a member like `.each`, changes the rules and their tests in
  `test/oxlint.test.ts` in the same change.

## CPU, memory, and measurement

- Design for CPU and memory efficiency from the outset. Avoid unnecessary copies,
  allocations, loops, conversions, and repeated computation.
- Balance performance against complexity and clarity. When the tradeoff is
  uncertain, run the code, measure representative workloads, and evaluate the
  result. Do not rely solely on intuition about what should be faster.
- For performance changes, compare actual behavior before and after, including
  relevant CPU or memory costs. Preserve correctness and public contracts.
  Report the workload, results, and limitations of the measurement; distinguish
  measured results from expectations.

## Refactoring and language evolution

- Before undertaking a broader refactor discovered during a task, propose it to
  the user. Show concrete evidence of the problem, the proposed design, affected
  scope, benefits, and costs. Wait for a decision before implementing that broader
  change. Routine local structuring within the agreed task can proceed.
- Consider current language and platform capabilities. A built-in may replace
  custom code or a dependency when supported by the project's target runtimes and
  compatible with the required behavior. Preserve the intent of the design while
  evaluating better ways to express it.

## Tests

- Test the public API, not the implementation. Assert what a caller can
  observe, such as the results it gets and the errors raised. Do not assert
  private state or which code path ran.
- Import what a test tests by the name that the package exports it under,
  as `hypotes` or `hypotes/fast-check`, which `yarn test:dist` runs on the
  bundle. Import what the package doesn't export by its private path, as
  `test/title.test.ts` imports `#source/title`. A private path names the
  source in both runs, so under `yarn test:dist` it loads a second copy of
  the module beside the bundle's. That suits a module without state, such as
  `equals.ts`; test one that holds state, such as `tests.ts` or `mocks.ts`,
  through the exports.
- Prefer property tests, with fast-check.
- Use generic shapes in examples and tests, rather than the formats of any one
  application.
- Add example tests where they document behavior, and regression cases for
  known failures. Cover boundary cases, such as signed zero and NaN, empty and
  sparse arrays, and typed arrays.
- Compare floats by their bits or with `Object.is`. Some deep-equality matchers
  treat -0 as 0, so check that an assertion about signed zero fails against
  code that loses the sign.
- Test how declarations run through node:test's results, not through
  hypotes' own state. node:test runs no other files from a test file's
  process, so `test/declarations.test.ts` runs the fixtures in
  `test/fixtures/` in another process, with `test/fixtures/results.ts`, and
  checks each test's result by its title: whether it passed, was skipped, or
  was to do, its error, and where it was declared. Add a case for new
  declaration behavior to the fixture and its expected result to the test.
  Some fixture tests fail on purpose. A fixture that mocks modules runs with
  `hypotes/register`, as `test/fixtures/mocks.ts` does.
- `test/cli.test.ts` runs the command in another process, in
  `test/fixtures/projects/`, and checks what it prints and how it exits. It
  resolves the command as `hypotes/cli`, which is exported for that: the
  bundle's under `yarn test:dist`.
- `test/reporter.test.ts` runs the fixtures in `test/fixtures/projects/`
  with the reporter in another process, and checks what it prints. Each
  directory there is a package of its own, so its files can't import
  hypotes, and declare node:test's tests. It gives the reporter events of
  its own making only for what a run in the repository can't have, such as
  a file that no package is above.
- `yarn test` preloads `hypotes/register`, which node:test passes on to each
  test file's process, so a test file can mock modules, as
  `test/mocks.test.ts` does. A mock lasts for the rest of the file's
  process, so a test that calls `vi.doMock` ends it, as that file's
  `afterEach` does.
- `expect.extend()` and `expect.addEqualityTesters()` change every test in
  the process. A test that calls them leaves the matchers and testers as they
  were, as `test/equals.test.ts` does.
- Fake timers, a faked date, and stubs last until they're undone, so a test
  file that sets them undoes them in an `afterEach`, as
  `test/timers.test.ts` and `test/stubs.test.ts` do.
- Use meaningful test names and keep grouping shallow. Add `describe` blocks
  when they organize related behavior, rather than repeating the file's identity.
- Run the relevant code and checks, and state anything that could not be run.

## Package and runtime

- The package supports the versions of Node that `engines` names, and CI
  tests each of them. Use a built-in, such as `getCallSites`, only when every
  one of them has it. `engines` starts at 24.13.1, where
  `module.registerHooks`, which `hypotes/register` builds on, became a
  release candidate.
- The package runs on Linux, macOS, and Windows, where CI tests it. Build
  paths with `node:path` and `node:url`, and keep in mind that a Windows
  path, such as `C:\a.ts`, parses as a URL. Yarn runs the scripts in
  `package.json` in its own shell, the same on each, but runs commands such
  as `rm` from the system, which Windows doesn't have, so do such steps in
  Node or in a tool's configuration, as `rolldown.config.ts` empties
  `dist/`.
- Node runs the TypeScript source as it is, by stripping its types, so use
  only erasable syntax, and import relative modules with their `.ts`
  extensions.
- Import a module in the same directory, or in one below it, by its relative
  path, as `./site.ts`. Import one in a parent directory by a private path
  of package.json's `imports`, as `#source/site` or `#test/rule-tester`,
  rather than by `../`. A private path leaves out the extension, which
  `imports` adds: tsc rewrites the extensions of relative paths only, and
  rejects any other that ends in `.ts` where it writes declarations. Import
  an entry point by the name that the package exports it under, as
  `hypotes/oxlint`, not by its private path. oxlint checks each of these.
- Name TypeScript and JavaScript files and their folders in kebab-case, as
  `rule-tester.ts`, whatever they export. oxlint checks the files' names.
- `yarn build` bundles each entry point into `dist/` with rolldown, with the
  modules that entry points share in a chunk, and tsc writes the
  declarations. In this repository, the package's exports name the source, or
  the bundle with the `hypotes-dist` condition, which `yarn test:dist` runs
  the tests on; the published package's, in `publishConfig`, name the bundle.
  A new entry point goes in `rolldown.config.ts`, in both exports, and in
  the pattern of oxlint's `no-restricted-imports`. `bin` names the command's
  source, and `publishConfig`'s the bundle's.
- rolldown resolves the private paths as it bundles, so the bundle has none,
  but tsc keeps them in the declarations. The `imports` of `publishConfig`
  name the declarations in `dist/` for those, and nothing to run.
- The runtime dependencies are Vitest's packages, tinyrainbow, which
  they colour messages with, in the range that they require, and
  `@sinonjs/fake-timers`, at the version that Vitest bundles: `expect.ts`
  turns off the colours of the copy of tinyrainbow that they load, and
  `timers.ts` loads `@sinonjs/fake-timers` once a test fakes the timers or
  the date, so that a test file that doesn't fake them doesn't load it.
  fast-check, oxlint,
  oxc-parser, and magic-string are optional peer dependencies, for the entry
  points that need them: `hypotes/fast-check` imports fast-check,
  `source/oxlint` imports only oxlint's types, and `hypotes/register` loads
  oxc-parser and magic-string once a module calls `vi.mock`, so that a test
  file that doesn't mock modules doesn't load them. The bundle imports the
  dependencies and peer dependencies rather than including them.

## Documentation

- `README.md` is for the package's users, and is published with it. It says
  what hypotes is and when to use it, how to start, what each entry point
  has, what's left out of Vitest's API, and where behaviour differs. This
  file is for those who change the package. Keep each fact in one of them.
- Lead with the common case. The quick start is the shortest path to a
  passing test: install, a test file, `node --test`, and its output. Introduce
  what only some users need where they need it, as the preload
  `hypotes/register` comes with module mocks, not with the first command.
- Give steps in the order that a reader takes them. Name the file that a
  sample goes in, and show a command's output where it tells the reader
  that the step worked.
- Say why, not only what. A reader chooses between hypotes, Vitest, and
  node:test alone, so say what each choice costs. Don't retell the source:
  describe what a caller does and sees.
- Write short sentences, one idea in each. Two sentences read better than
  one with a chain of clauses, and a list or a table better than a long
  sentence of alternatives. Use numbered steps for a procedure, and a table
  for what a reader looks up. Leave out emoji, praise of the package, and
  sections that say nothing a reader needs.
- State only what was checked. Run every sample and command before
  committing it, on the built package, in a project outside the repository.
  Check a claim about Vitest's behaviour on Vitest. The samples pass the
  README's own oxlint configuration. Say in the pull request what was run,
  and what wasn't.
- A change to what the package exports changes the README in the same
  change: a new member, modifier, entry point, or lint rule, something left
  out, or a difference from Vitest. `test/readme.test.ts` compares the
  README's lists of lint rules and of `vi`'s members with the package's.
  Where the README names things one by one, add such a check for the list.
- Link to Vitest's and Node's documentation for what they document, rather
  than restating it.
- Don't add other documentation files, such as a changelog or a
  contributing guide, unless asked to.
- oxfmt ignores Markdown, so wrap prose at 80 columns by hand, and align
  the columns of tables.

## Formatting

- Follow the formatter and compiler configurations. oxfmt sets four-space
  indentation, single quotes, semicolons, no trailing commas, and contextual
  line widths. Intentional whitespace and readable structure still require
  judgment after automatic formatting.
- The formatting, the lint rules, and the compiler's options come from
  `@snovader/oxc-config` and `@snovader/tsconfig`, which benk and tafla
  share. `oxfmt.config.ts`, `oxlint.config.ts`, and `tsconfig.json` keep
  what is particular to hypotes: the paths that they ignore and include, the
  names that it imports itself by, its rules of imports, and its fixtures'
  exceptions. Change a shared setting in the packages, rather than
  overriding it here. `@snovader/oxc-config` needs Node 26 to load, which
  CI's checks of formatting and lint run on.
- oxlint loads `hypotes/oxlint` from `source/oxlint`, so that the package's
  tests are linted with the rules as they're written. The preset
  `@snovader/oxc-config/oxlint/hypotes` would load the published package
  instead. `oxlint.config.ts` turns on the same `hypotes/*` rules as that
  preset, so a rule turned on or off there changes here too.

## Repository commands

- Run the checks from the repository's root: `yarn format:check`,
  `yarn lint:check`, `yarn typecheck`, `yarn test`, and `yarn test:dist`,
  which builds the package and runs the tests on the bundle, with the
  bundle's `hypotes/register`.
  `.github/workflows/ci.yml` runs the same checks in CI, and the tests on each
  supported version of Node on Ubuntu, and on the oldest and the latest on
  macOS and Windows.

### Releasing

- A release on GitHub publishes the package. Set `version` in
  `package.json` in a pull request, then publish a release whose tag names
  it, as `v1.2.3`. `.github/workflows/release.yml` checks that the tag
  names the version, runs `ci.yml` on the tag, and publishes with
  `yarn npm publish`, through npm's trusted publishing, with provenance. A
  release marked as a pre-release goes under npm's `next` tag, and others
  under `latest`. The repository's rules keep `v*` tags from being moved or
  deleted, so a release that went wrong takes a new version.
- Pack and publish only with Yarn, which replaces the exports with those of
  `publishConfig`. npm keeps the source's, which the package leaves out, so
  `prepack` fails under any other package manager, in
  `scripts/require-yarn.ts`.
