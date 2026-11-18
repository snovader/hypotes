# Code and design guidelines

These repository guidelines apply when designing, implementing, reviewing, and
refactoring code. Use judgment about tradeoffs; existing code is evidence of
intent, not a requirement to preserve every detail.

## Responsibilities and architecture

- Give each function, class, and module a clear scope of responsibility.
  For example, `tests.ts` declares tests and suites, `hooks.ts` maps hooks onto
  node:test's, `expect.ts` assembles the matchers, `site.ts` records where
  each test was declared, `mocks.ts` mocks modules, and `hoist.ts` hoists the
  mocks of a test file.
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
  `skip`, `todo`, and `only` apply to them. `vi` has Vitest's spies, and
  node:test's `mock` mocks timers.
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
  readable from the message alone.
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
- `yarn test` preloads `hypotes/register`, which node:test passes on to each
  test file's process, so a test file can mock modules, as
  `test/mocks.test.ts` does. A mock lasts for the rest of the file's
  process, so a test that calls `vi.doMock` ends it, as that file's
  `afterEach` does.
- `expect.extend()` and `expect.addEqualityTesters()` change every test in
  the process. A test that calls them leaves the matchers and testers as they
  were, as `test/equals.test.ts` does.
- Use meaningful test names and keep grouping shallow. Add `describe` blocks
  when they organize related behavior, rather than repeating the file's identity.
- Run the relevant code and checks, and state anything that could not be run.

## Package and runtime

- The package supports the versions of Node that `engines` names, and CI
  tests each of them. Use a built-in, such as `getCallSites`, only when every
  one of them has it. `engines` starts at 24.13.1, where
  `module.registerHooks`, which `hypotes/register` builds on, became a
  release candidate.
- Node runs the TypeScript source as it is, by stripping its types, so use
  only erasable syntax, and import relative modules with their `.ts`
  extensions.
- `yarn build` bundles each entry point into `dist/` with rolldown, with the
  modules that entry points share in a chunk, and tsc writes the
  declarations. In this repository, the package's exports name the source, or
  the bundle with the `hypotes-dist` condition, which `yarn test:dist` runs
  the tests on; the published package's, in `publishConfig`, name the bundle.
  A new entry point goes in `rolldown.config.ts` and in both exports.
- The runtime dependencies are Vitest's packages alone. fast-check, oxlint,
  oxc-parser, and magic-string are optional peer dependencies, for the entry
  points that need them: `hypotes/fast-check` imports fast-check,
  `source/oxlint` imports only oxlint's types, and `hypotes/register` loads
  oxc-parser and magic-string once a module calls `vi.mock`, so that a test
  file that doesn't mock modules doesn't load them. The bundle imports the
  dependencies and peer dependencies rather than including them.

## Formatting

- Follow the formatter and compiler configurations. oxfmt sets four-space
  indentation, single quotes, semicolons, no trailing commas, and contextual
  line widths. Intentional whitespace and readable structure still require
  judgment after automatic formatting.

## Repository commands

- Run the checks from the repository's root: `yarn format:check`,
  `yarn lint:check`, `yarn typecheck`, `yarn test`, and `yarn test:dist`,
  which builds the package and runs the tests on the bundle, with the
  bundle's `hypotes/register`.
  `.github/workflows/ci.yml` runs the same checks in CI, and the tests on each
  supported version of Node.
