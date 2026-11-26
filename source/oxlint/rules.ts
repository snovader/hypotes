// Rules for tests that run on hypotes, which declares them through
// node:test with Vitest's API, in place of oxlint's vitest rules, which see
// only the tests and assertions imported from vitest. A test is a call of
// `it` or `test` from hypotes, its fast-check subpath or node:test, and a
// describe block is a call of `describe` or `suite` from them, through any of
// their variants, such as `it.only`, and of the functions that `it.each()`,
// `it.for()`, `it.prop()`, `it.skipIf()` and `it.runIf()` return, and that
// `it.each` and `it.for` return for a table in a template literal. An
// assertion is a call of hypotes' `expect`, `expect.soft` or `expect.poll`,
// or, to expect-expect, of any function whose name starts with `expect`, or
// of its `soft` or `poll`, and `vi` is hypotes' `vi`.
//
// They find what oxlint's do, with these differences. TypeScript checks the
// types of arguments, such as a title's, so the rules don't. They take no
// options. They read the options of a test before its function, where Vitest
// and node:test take them: no-focused-tests, no-disabled-tests and warn-todo
// report `only`, `skip` and `todo` there too. valid-expect-in-promise follows a promise
// through the variable that holds it, and counts a method of Promise, such
// as `Promise.all()`, only where it's awaited or returned. hoisted-apis-on-top
// accepts what `hypotes/register` hoists: `vi.hoisted()` that declares one
// variable at most.
import type { Context, Fix, NodeOf, Rule } from './types.ts';

type CallExpression = NodeOf<'CallExpression'>;
type Argument = CallExpression['arguments'][number];
type Identifier = NodeOf<'Identifier'>;
type Node = CallExpression['parent'];
type StaticMemberExpression = Extract<
    NodeOf<'MemberExpression'>,
    { computed: false; property: { type: 'Identifier' } }
>;
type FunctionExpression =
    | NodeOf<'ArrowFunctionExpression'>
    | NodeOf<'FunctionExpression'>;
type Scope = ReturnType<Context['sourceCode']['getScope']>;
type Variable = Scope['variables'][number];
type Suggestion = NonNullable<
    Parameters<Context['report']>[0]['suggest']
>[number];

/** What an imported name is to these rules */
type Role = 'describe' | 'expect' | 'test' | 'vi';

/** A call that declares a test or a describe block */
interface Declaration {
    readonly call: CallExpression;
    readonly kind: 'describe' | 'test';
    /** The name that its module exports the declarer under, as `it` */
    readonly name: string;
    /**
     * The variants and factories that it declares through, such as `skip`
     * and `each` in `it.skip.each(rows)()`
     */
    readonly members: readonly StaticMemberExpression[];
}

/** A name and the module that it's imported from */
interface Import {
    readonly source: string;
    readonly name: string;
}

/** Members of `it`, `test`, `describe` and `suite` that are called as they are */
const VARIANTS: ReadonlySet<string> = new Set([
    'fails',
    'only',
    'skip',
    'todo'
]);

/**
 * Members of `it`, `test`, `describe` and `suite` that return the function
 * that declares, as `it.each(rows)` does
 */
const FACTORIES: ReadonlySet<string> = new Set([
    'each',
    'for',
    'prop',
    'runIf',
    'skipIf'
]);

/**
 * Members of `it`, `test`, `describe` and `suite` that return the function
 * that declares for a table in a template literal, as `` it.each`table` ``
 * does
 */
const TABLE_FACTORIES: ReadonlySet<string> = new Set(['each', 'for']);

/** Members between `expect()` and its matcher */
const MODIFIERS: ReadonlySet<string> = new Set(['not', 'rejects', 'resolves']);

/** Modifiers whose matchers return promises */
const ASYNC_MODIFIERS: ReadonlySet<string> = new Set(['rejects', 'resolves']);

/**
 * Members of `expect` that start an assertion, as it does, such as
 * `expect.soft(actual)`
 */
const EXPECT_MEMBERS: ReadonlySet<string> = new Set(['poll', 'soft']);

/** Members of `expect` that start an assertion whose matchers return promises */
const ASYNC_EXPECT_MEMBERS: ReadonlySet<string> = new Set(['poll']);

/** Matchers of one value, for which others may say more */
const EQUALITY_MATCHERS: ReadonlySet<string> = new Set([
    'toBe',
    'toEqual',
    'toStrictEqual'
]);

const NOT: ReadonlySet<string> = new Set(['not']);

const LENGTH: ReadonlySet<string> = new Set(['length']);

/** Matchers that take what the error should be, which they may leave out */
const THROW_MATCHERS: ReadonlySet<string> = new Set([
    'toThrow',
    'toThrowError'
]);

/** The methods of a promise that take callbacks, and return another */
const PROMISE_METHODS: ReadonlySet<string> = new Set([
    'catch',
    'finally',
    'then'
]);

/** The methods of `vi` whose calls `hypotes/register` hoists */
const HOISTED_METHODS: ReadonlySet<string> = new Set([
    'hoisted',
    'mock',
    'unmock'
]);

/** The methods of `vi` that do what hoisted ones do, where they're called */
const UNHOISTED: ReadonlyMap<string, string> = new Map([
    ['mock', 'doMock'],
    ['unmock', 'doUnmock']
]);

/** Files of TypeScript, where a call can take type arguments */
const TYPESCRIPT = /\.[cm]?tsx?$/;

/**
 * An `expect()` call, or `expect.soft()` or `expect.poll()`, the modifiers
 * after it, such as `.not`, and its matcher
 */
interface ExpectChain {
    readonly expect: CallExpression;
    /** `.poll`, if the chain starts with `expect.poll()` */
    readonly poll: StaticMemberExpression | undefined;
    readonly modifiers: readonly StaticMemberExpression[];
    /** `.toBe`, if the chain names a matcher */
    readonly matcher: StaticMemberExpression | undefined;
    /** `.toBe(expected)`, if the chain calls its matcher */
    readonly matcherCall: CallExpression | undefined;
}

/** A chain that calls toBe(), toEqual() or toStrictEqual() */
interface Comparison extends ExpectChain {
    readonly matcher: StaticMemberExpression;
    readonly matcherCall: CallExpression;
}

/** The modules that declare tests, which hypotes declares them through */
const TEST_MODULES: ReadonlySet<string> = new Set([
    'node:test',
    'hypotes',
    'hypotes/fast-check'
]);

function roleOfImport(source: string, name: string): Role | undefined {
    if (!TEST_MODULES.has(source)) {
        return undefined;
    }

    switch (name) {
        case 'describe':
        case 'suite':
            return 'describe';
        case 'it':
        case 'test':
            return 'test';
        case 'expect':
            return source === 'hypotes' ? 'expect' : undefined;
        case 'vi':
            return source === 'hypotes' ? 'vi' : undefined;
        default:
            return undefined;
    }
}

/** The variable that an identifier refers to, from the scopes around it */
function variableOf(
    context: Context,
    identifier: Identifier
): Variable | undefined {
    let scope: Scope | null = context.sourceCode.getScope(identifier);
    while (scope != null) {
        const variable = scope.set.get(identifier.name);
        if (variable != null) {
            return variable;
        }
        scope = scope.upper;
    }

    return undefined;
}

/** The named import that an identifier refers to */
function importOf(
    context: Context,
    identifier: Identifier
): Import | undefined {
    const definition = variableOf(context, identifier)?.defs[0];
    if (definition?.type !== 'ImportBinding') {
        return undefined;
    }

    const { node: specifier, parent: declaration } = definition;
    if (
        specifier.type !== 'ImportSpecifier' ||
        declaration?.type !== 'ImportDeclaration'
    ) {
        return undefined;
    }

    const { imported } = specifier;
    const name =
        imported.type === 'Identifier' ? imported.name : imported.value;

    return { source: declaration.source.value, name };
}

/** What an identifier is to these rules, from the import that it refers to */
function roleOf(context: Context, identifier: Identifier): Role | undefined {
    const imported = importOf(context, identifier);
    return imported && roleOfImport(imported.source, imported.name);
}

/** Whether a node is a member named in the source, as `only` is in `it.only` */
function isStaticMember(node: Node | null): node is StaticMemberExpression {
    return (
        node?.type === 'MemberExpression' &&
        !node.computed &&
        node.property.type === 'Identifier'
    );
}

/** Whether a node is a member that one of the names names */
function isNamedMember(
    node: Node,
    names: ReadonlySet<string>
): node is StaticMemberExpression {
    return isStaticMember(node) && names.has(node.property.name);
}

/** The member of a node after it, as `.not` is of `expect(actual)` */
function memberAfter(
    node: Node,
    names?: ReadonlySet<string>
): StaticMemberExpression | undefined {
    const { parent } = node;
    if (!isStaticMember(parent) || parent.object !== node) {
        return undefined;
    }

    return names == null || names.has(parent.property.name)
        ? parent
        : undefined;
}

/** The nodes around a node, from its parent out */
function* ancestorsOf(node: Node): Generator<Node> {
    for (
        let ancestor = node.parent;
        ancestor != null;
        ancestor = ancestor.parent
    ) {
        yield ancestor;
    }
}

function isFunction(node: Node): boolean {
    return (
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression'
    );
}

/** Whether a call is a test or a describe block */
function blockOf(
    context: Context,
    call: CallExpression
): 'describe' | 'test' | undefined {
    const target = declarerOf(call.callee);
    if (target.type !== 'Identifier') {
        return undefined;
    }

    const role = roleOf(context, target);
    return role === 'describe' || role === 'test' ? role : undefined;
}

/** The test or the describe block that a call declares */
function declarationOf(
    context: Context,
    call: CallExpression
): Declaration | undefined {
    const target = declarerOf(call.callee);
    const imported =
        target.type === 'Identifier' ? importOf(context, target) : undefined;
    if (imported == null) {
        return undefined;
    }

    const kind = roleOfImport(imported.source, imported.name);
    if (kind !== 'describe' && kind !== 'test') {
        return undefined;
    }

    // Collected for declarations only, rather than for every call
    const members: StaticMemberExpression[] = [];
    declarerOf(call.callee, members);

    return { call, kind, name: imported.name, members };
}

/**
 * What a call's callee declares through: `it` for `it()`, `it.skip()`,
 * `it.each(rows)()`, `` it.each`table`() `` and `it.skipIf(condition).only()`.
 * It adds the members that it passes to `members`, if given.
 */
function declarerOf(
    callee: CallExpression['callee'],
    members?: StaticMemberExpression[]
): Node {
    let target: Node = callee;

    for (;;) {
        if (
            target.type === 'CallExpression' &&
            isNamedMember(target.callee, FACTORIES)
        ) {
            members?.push(target.callee);
            target = target.callee.object;
        } else if (
            target.type === 'TaggedTemplateExpression' &&
            isNamedMember(target.tag, TABLE_FACTORIES)
        ) {
            members?.push(target.tag);
            target = target.tag.object;
        } else if (isNamedMember(target, VARIANTS)) {
            members?.push(target);
            target = target.object;
        } else {
            return target;
        }
    }
}

/** The member of a declaration with the name, as `.only` of `it.only()` */
function memberNamed(
    declaration: Declaration,
    name: string
): StaticMemberExpression | undefined {
    return declaration.members.find(member => member.property.name === name);
}

/** What a declaration is, in a message */
function nameOfKind(declaration: Declaration): string {
    return declaration.kind === 'test' ? 'the test' : 'the describe block';
}

function isFunctionExpression(node: Node): node is FunctionExpression {
    return (
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionExpression'
    );
}

/**
 * The function that a declaration passes, as hypotes reads it: after the
 * title, or after the options that come before it
 */
function functionOf(call: CallExpression): Argument | undefined {
    const [, first, second] = call.arguments;
    if (first == null || isFunctionExpression(first)) {
        return first;
    }
    if (second != null && isFunctionExpression(second)) {
        return second;
    }

    return first.type === 'ObjectExpression' ? second : first;
}

/**
 * The option of a declaration with the name, if the declaration passes it
 * in an object written in place, and it's a literal that turns it on, such
 * as `{ skip: true }` or `{ skip: 'a reason' }`
 */
function optionNamed(call: CallExpression, name: string): Node | undefined {
    // After the title, and before the function
    const options = call.arguments[1];
    if (options?.type !== 'ObjectExpression') {
        return undefined;
    }

    for (const property of options.properties) {
        if (
            property.type === 'Property' &&
            keyNameOf(property) === name &&
            isTruthyLiteral(property.value)
        ) {
            return property;
        }
    }

    return undefined;
}

/** The name of a property's key, if the source names it */
function keyNameOf(property: NodeOf<'Property'>): string | undefined {
    const { key } = property;
    if (key.type === 'Identifier' && !property.computed) {
        return key.name;
    }

    return key.type === 'Literal' && typeof key.value === 'string'
        ? key.value
        : undefined;
}

function isTruthyLiteral(node: Node): boolean {
    return node.type === 'Literal' && !('regex' in node) && Boolean(node.value);
}

/**
 * Whether a call passes a function written in place: a test's, after its
 * title or its options
 */
function hasCallback(call: CallExpression): boolean {
    return call.arguments.some(isFunctionExpression);
}

/** Whether a call starts an assertion: `expect()`, or a member that does */
function isExpectCall(context: Context, call: CallExpression): boolean {
    const target = isNamedMember(call.callee, EXPECT_MEMBERS)
        ? call.callee.object
        : call.callee;

    return target.type === 'Identifier' && roleOf(context, target) === 'expect';
}

/**
 * Whether a call's callee is named as an assertion, to expect-expect:
 * `expectOne()`, or `expect.soft()` or `expect.poll()`
 */
function isNamedAssertion(callee: CallExpression['callee']): boolean {
    const target = isNamedMember(callee, EXPECT_MEMBERS)
        ? callee.object
        : callee;

    return target.type === 'Identifier' && target.name.startsWith('expect');
}

/** The chain that a call starts, if it calls `expect` */
function expectChainOf(
    context: Context,
    call: CallExpression
): ExpectChain | undefined {
    if (!isExpectCall(context, call)) {
        return undefined;
    }

    const modifiers: StaticMemberExpression[] = [];
    let end: Node = call;
    let modifier = memberAfter(end, MODIFIERS);
    while (modifier != null) {
        modifiers.push(modifier);
        end = modifier;
        modifier = memberAfter(end, MODIFIERS);
    }

    const matcher = memberAfter(end);
    const parent = matcher?.parent;
    const matcherCall =
        parent?.type === 'CallExpression' && parent.callee === matcher
            ? parent
            : undefined;
    const poll = isNamedMember(call.callee, ASYNC_EXPECT_MEMBERS)
        ? call.callee
        : undefined;

    return { expect: call, poll, modifiers, matcher, matcherCall };
}

/** The chain that a call starts, if it compares with toBe(), toEqual() or toStrictEqual() */
function comparisonOf(
    context: Context,
    call: CallExpression
): Comparison | undefined {
    const chain = expectChainOf(context, call);
    if (chain == null) {
        return undefined;
    }

    const { matcher, matcherCall } = chain;
    if (
        matcher == null ||
        matcherCall == null ||
        !EQUALITY_MATCHERS.has(matcher.property.name)
    ) {
        return undefined;
    }

    return { ...chain, matcher, matcherCall };
}

function hasModifier(chain: ExpectChain, names: ReadonlySet<string>): boolean {
    return chain.modifiers.some(modifier => names.has(modifier.property.name));
}

/**
 * Whether an expect() call runs in a test, or in a function of its own,
 * which a test may call. A function passed to a call, such as the callback
 * of `forEach()`, runs where the call runs.
 */
function runsInTest(context: Context, call: CallExpression): boolean {
    for (const ancestor of ancestorsOf(call)) {
        if (ancestor.type === 'CallExpression') {
            const block = blockOf(context, ancestor);
            if (block != null) {
                return block === 'test';
            }
        } else if (
            isFunction(ancestor) &&
            ancestor.parent?.type !== 'CallExpression'
        ) {
            return true;
        }
    }

    return false;
}

/**
 * Whether a promise, which a call returns or a variable holds, is awaited or
 * returned, by itself or in an array that a method of Promise takes, as in
 * `await Promise.all([...])`
 */
function isAwaitedOrReturned(promise: CallExpression | Identifier): boolean {
    const { parent } = promise;
    if (
        parent.type === 'AwaitExpression' ||
        parent.type === 'ReturnStatement' ||
        (parent.type === 'ArrowFunctionExpression' && parent.body === promise)
    ) {
        return true;
    }

    const combined = promiseCallOf(promise);
    return combined != null && isAwaitedOrReturned(combined);
}

/**
 * The call of a method of Promise, such as `Promise.all()`, with an array
 * that the node is an element of
 */
function promiseCallOf(node: Node): CallExpression | undefined {
    const array = node.parent;
    const call = array?.parent;
    if (
        array?.type !== 'ArrayExpression' ||
        call?.type !== 'CallExpression' ||
        call.callee === array ||
        !isStaticMember(call.callee)
    ) {
        return undefined;
    }

    const { object } = call.callee;
    return object.type === 'Identifier' && object.name === 'Promise'
        ? call
        : undefined;
}

function isNull(node: Argument): boolean {
    return node.type === 'Literal' && !('regex' in node) && node.value === null;
}

function isIdentifierNamed(node: Argument, name: string): boolean {
    return node.type === 'Identifier' && node.name === name;
}

/** Whether a node is a string, number, bigint or boolean written literally */
function isPrimitiveLiteral(node: Argument): boolean {
    switch (node.type) {
        case 'Literal':
            return !('regex' in node) && node.value !== null;
        case 'TemplateLiteral':
            return node.expressions.length === 0;
        case 'UnaryExpression':
            return (
                node.operator === '-' &&
                node.argument.type === 'Literal' &&
                (typeof node.argument.value === 'number' ||
                    typeof node.argument.value === 'bigint')
            );
        default:
            return false;
    }
}

/**
 * The matcher that says more than toBe(), toEqual() or toStrictEqual() of
 * the value expected: toBeNull() of null, for example, or toBe() of a
 * primitive
 */
function preferredMatcher(
    comparison: Comparison,
    expected: Argument
): string | undefined {
    if (isNull(expected)) {
        return 'toBeNull';
    }
    if (isIdentifierNamed(expected, 'undefined')) {
        return hasModifier(comparison, NOT) ? 'toBeDefined' : 'toBeUndefined';
    }
    if (isIdentifierNamed(expected, 'NaN')) {
        return 'toBeNaN';
    }

    const isToBe = comparison.matcher.property.name === 'toBe';
    return !isToBe && isPrimitiveLiteral(expected) ? 'toBe' : undefined;
}

/** Writes the preferred matcher in place of the comparison's */
function replaceMatcher(comparison: Comparison, preferred: string): Fix {
    const { expect, matcher, matcherCall, modifiers } = comparison;

    if (preferred === 'toBe') {
        return fixer => fixer.replaceText(matcher.property, 'toBe');
    }

    // toBeDefined() is not.toBeUndefined(), so it takes the place of `.not`
    if (preferred === 'toBeDefined') {
        const kept = modifiers
            .filter(modifier => modifier.property.name !== 'not')
            .map(modifier => `.${modifier.property.name}`)
            .join('');

        return fixer =>
            fixer.replaceTextRange(
                [expect.end, matcherCall.end],
                `${kept}.toBeDefined()`
            );
    }

    return fixer =>
        fixer.replaceTextRange(
            [matcher.property.start, matcherCall.end],
            `${preferred}()`
        );
}

/**
 * Whether a declaration is marked as to do, which it may be without a
 * function
 */
function isToDo(declaration: Declaration): boolean {
    return (
        memberNamed(declaration, 'todo') != null ||
        optionNamed(declaration.call, 'todo') != null
    );
}

/** Whether an if statement is around a node, which runs only on its condition */
function isInIfStatement(node: Node): boolean {
    for (const ancestor of ancestorsOf(node)) {
        if (ancestor.type === 'IfStatement') {
            return true;
        }
    }

    return false;
}

/**
 * What a describe block's function returns: the first return statement at
 * the top of its body, or the call that an arrow function's body is
 */
function returnOf(callback: FunctionExpression): Node | undefined {
    // A function expression has a body, which only a declared one leaves out
    const { body } = callback;
    if (body?.type !== 'BlockStatement') {
        return body?.type === 'CallExpression' ? body : undefined;
    }

    return body.body.find(statement => statement.type === 'ReturnStatement');
}

/** A title written as a string, or as a template without expressions */
interface Title {
    readonly node: Argument;
    /** Its text, with its escapes replaced */
    readonly cooked: string;
    /** Its text as the source writes it, between its quotes */
    readonly raw: string;
}

function titleOf(context: Context, call: CallExpression): Title | undefined {
    const [title] = call.arguments;
    if (title?.type === 'Literal' && typeof title.value === 'string') {
        const raw = context.sourceCode.getText(title).slice(1, -1);
        return { node: title, cooked: title.value, raw };
    }

    if (title?.type !== 'TemplateLiteral' || title.expressions.length > 0) {
        return undefined;
    }

    // A template with an invalid escape has no cooked text
    const [{ value }] = title.quasis;
    return value.cooked == null
        ? undefined
        : { node: title, cooked: value.cooked, raw: value.raw };
}

/** The range of a title's text, between its quotes */
function textRangeOf(title: Title): [number, number] {
    return [title.node.start + 1, title.node.end - 1];
}

/**
 * Whether the cooked text and the raw text of a title have as much
 * whitespace at their starts and their ends, which trimming the raw text
 * removes, unless the raw text escapes it, as in `'\t'`
 */
function canTrimRaw(cooked: string, raw: string): boolean {
    return (
        cooked.length - cooked.trimStart().length ===
            raw.length - raw.trimStart().length &&
        cooked.length - cooked.trimEnd().length ===
            raw.length - raw.trimEnd().length
    );
}

/** Whether a text's first word, before its first space, is the word */
function startsWithWord(text: string, word: string): boolean {
    return (
        text.startsWith(word) &&
        (text.length === word.length || text[word.length] === ' ')
    );
}

function reportSpaces(context: Context, title: Title): void {
    const { cooked, raw } = title;
    const canFix = canTrimRaw(cooked, raw);

    context.report({
        node: title.node,
        message: 'Expected a title without spaces at its start or end',
        fix: fixer =>
            canFix
                ? fixer.replaceTextRange(textRangeOf(title), raw.trim())
                : null
    });
}

/** Reports a title whose first word is the name that declares it */
function reportPrefix(context: Context, title: Title, name: string): void {
    const { cooked, raw } = title;
    const rest = cooked.slice(name.length + 1);
    const rawRest = raw.slice(name.length + 1);
    const canFix =
        rest.length > 0 &&
        raw.startsWith(`${name} `) &&
        canTrimRaw(rest, rawRest);

    context.report({
        node: title.node,
        message: `Expected the title not to start with ${name}, which declares it`,
        fix: fixer =>
            canFix
                ? fixer.replaceTextRange(textRangeOf(title), rawRest.trim())
                : null
    });
}

/**
 * The call of .then(), .catch() or .finally() that takes a function as one
 * of its callbacks, its first two arguments
 */
function promiseCallTaking(fn: FunctionExpression): CallExpression | undefined {
    const call = fn.parent;
    if (
        call.type !== 'CallExpression' ||
        !isNamedMember(call.callee, PROMISE_METHODS)
    ) {
        return undefined;
    }

    const [onFulfilled, onRejected] = call.arguments;
    return fn === onFulfilled || fn === onRejected ? call : undefined;
}

/**
 * The last call of the chain of .then(), .catch() and .finally() that a
 * call is in, whose promise the chain returns
 */
function chainEndOf(call: CallExpression): CallExpression {
    let end = call;

    for (;;) {
        const member = memberAfter(end, PROMISE_METHODS);
        const next = member?.parent;
        if (next?.type !== 'CallExpression' || next.callee !== member) {
            return end;
        }

        end = next;
    }
}

/**
 * The promises whose callbacks run a node, from the inside out, until the
 * declaration that runs it: the test waits for the node only if it waits
 * for each of them
 */
function* promisesAround(
    context: Context,
    node: Node
): Generator<CallExpression> {
    for (const ancestor of ancestorsOf(node)) {
        if (
            ancestor.type === 'CallExpression' &&
            blockOf(context, ancestor) != null
        ) {
            return;
        }

        const call = isFunctionExpression(ancestor)
            ? promiseCallTaking(ancestor)
            : undefined;
        if (call != null) {
            yield chainEndOf(call);
        }
    }
}

/**
 * Whether a promise is awaited or returned, or expected to resolve or
 * reject, where it is, or through the variable that holds it
 */
function isWaitedFor(context: Context, promise: CallExpression): boolean {
    if (isWaitedForInPlace(context, promise)) {
        return true;
    }

    const variable = variableHolding(context, promise);
    return (
        variable?.references.some(
            reference =>
                reference.isRead() &&
                isWaitedForInPlace(context, reference.identifier)
        ) ?? false
    );
}

function isWaitedForInPlace(
    context: Context,
    promise: CallExpression | Identifier
): boolean {
    return isAwaitedOrReturned(promise) || isExpectedToSettle(context, promise);
}

/** Whether expect() takes a promise, to assert with .resolves or .rejects */
function isExpectedToSettle(
    context: Context,
    promise: CallExpression | Identifier
): boolean {
    const { parent } = promise;
    if (parent.type !== 'CallExpression' || parent.arguments[0] !== promise) {
        return false;
    }

    const chain = expectChainOf(context, parent);
    return chain != null && hasModifier(chain, ASYNC_MODIFIERS);
}

/** The variable that a promise is assigned to, where it's declared or later */
function variableHolding(
    context: Context,
    promise: CallExpression
): Variable | undefined {
    const { parent } = promise;
    if (
        parent.type === 'VariableDeclarator' &&
        parent.init === promise &&
        parent.id.type === 'Identifier'
    ) {
        return variableOf(context, parent.id);
    }

    if (
        parent.type === 'AssignmentExpression' &&
        parent.right === promise &&
        parent.left.type === 'Identifier'
    ) {
        return variableOf(context, parent.left);
    }

    return undefined;
}

/** The member of hypotes' `vi` that a call calls, as `vi.fn` */
function viMethodOf(
    context: Context,
    call: CallExpression
): StaticMemberExpression | undefined {
    const { callee } = call;
    return isStaticMember(callee) &&
        callee.object.type === 'Identifier' &&
        roleOf(context, callee.object) === 'vi'
        ? callee
        : undefined;
}

/**
 * Whether a call of a hoisted method of `vi` is where `hypotes/register`
 * hoists it from: a statement of its own at the module's top level, which
 * may await `vi.hoisted()`, and declare the one variable that it returns
 */
function isHoistable(call: CallExpression, method: string): boolean {
    const awaits =
        method === 'hoisted' && call.parent.type === 'AwaitExpression';
    const expression = awaits ? call.parent : call;
    const { parent } = expression;

    if (parent?.type === 'ExpressionStatement') {
        return parent.parent.type === 'Program';
    }
    if (
        method !== 'hoisted' ||
        parent?.type !== 'VariableDeclarator' ||
        parent.init !== expression
    ) {
        return false;
    }

    const declaration = parent.parent;
    return (
        declaration.type === 'VariableDeclaration' &&
        declaration.declarations.length === 1 &&
        declaration.parent.type === 'Program'
    );
}

/**
 * The fixes that a hoisted call can take: moving its statement to the
 * module's top level, after the imports, or calling the method of `vi`
 * that isn't hoisted, such as `vi.doMock()`
 */
function hoistingSuggestions(
    context: Context,
    call: CallExpression,
    method: StaticMemberExpression
): Suggestion[] {
    const suggestions: Suggestion[] = [];

    const statement = call.parent;
    if (statement.type === 'ExpressionStatement') {
        suggestions.push(moveToTopLevel(context, statement));
    }

    const unhoisted = UNHOISTED.get(method.property.name);
    if (unhoisted) {
        suggestions.push({
            desc: `Call vi.${unhoisted}(), which runs where it's called`,
            fix: fixer => fixer.replaceText(method.property, unhoisted)
        });
    }

    return suggestions;
}

function moveToTopLevel(
    context: Context,
    statement: NodeOf<'ExpressionStatement'>
): Suggestion {
    const { sourceCode } = context;
    const text = sourceCode.getText(statement);
    // The rules recognize `vi` by its import, so there's one to follow
    const lastImport = sourceCode.ast.body.findLast(
        node => node.type === 'ImportDeclaration'
    );
    const end = lastImport?.end ?? 0;

    return {
        desc: "Move it to the module's top level, after its imports",
        fix: fixer => [
            fixer.remove(statement),
            fixer.insertTextAfterRange([end, end], `\n${text}`)
        ]
    };
}

export const expectExpect: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Requires each test written in place to call expect(), or a function whose name starts with expect'
        }
    },
    create(context) {
        // Tests that call no assertion so far
        const unasserted = new Set<CallExpression>();

        return {
            CallExpression(call): void {
                if (isNamedAssertion(call.callee)) {
                    for (const ancestor of ancestorsOf(call)) {
                        if (ancestor.type === 'CallExpression') {
                            unasserted.delete(ancestor);
                        }
                    }
                } else if (
                    hasCallback(call) &&
                    blockOf(context, call) === 'test'
                ) {
                    unasserted.add(call);
                }
            },
            'Program:exit'(): void {
                for (const test of unasserted) {
                    context.report({
                        node: test.callee,
                        message:
                            'Expected the test to call expect(), or a function whose name starts with expect'
                    });
                }
            }
        };
    }
};

export const noStandaloneExpect: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Requires expect() to run in a test, or in a function of its own, rather than in a describe block or at the top of a module'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                if (isExpectCall(context, call) && !runsInTest(context, call)) {
                    context.report({
                        node: call,
                        message:
                            'Expected expect() in a test, or in a function of its own, rather than in a describe block or at the top of the module'
                    });
                }
            }
        };
    }
};

export const validExpect: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Requires a matcher to be called on expect(), and the promise of expect.poll(), .resolves or .rejects to be awaited or returned. TypeScript checks the arguments of expect().'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const chain = expectChainOf(context, call);
                if (chain == null) {
                    return;
                }

                const { matcherCall } = chain;
                if (matcherCall == null) {
                    context.report({
                        node: call,
                        message:
                            'Expected a matcher, such as toBe(), to be called on expect()'
                    });
                } else if (
                    chain.poll != null &&
                    !isAwaitedOrReturned(matcherCall)
                ) {
                    context.report({
                        node: matcherCall,
                        message:
                            'Expected the promise of expect.poll() to be awaited or returned'
                    });
                } else if (
                    hasModifier(chain, ASYNC_MODIFIERS) &&
                    !isAwaitedOrReturned(matcherCall)
                ) {
                    context.report({
                        node: matcherCall,
                        message:
                            'Expected the promise of .resolves or .rejects to be awaited or returned'
                    });
                }
            }
        };
    }
};

export const preferToBe: Rule = {
    meta: {
        type: 'suggestion',
        fixable: 'code',
        docs: {
            description:
                'Prefers toBe() of a primitive, which compares with Object.is, to toEqual() and toStrictEqual(), and toBeNull(), toBeUndefined(), toBeDefined() and toBeNaN() to comparisons with those values'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const comparison = comparisonOf(context, call);
                const [expected] = comparison?.matcherCall.arguments ?? [];
                if (
                    comparison == null ||
                    expected == null ||
                    comparison.matcherCall.arguments.length !== 1
                ) {
                    return;
                }

                const preferred = preferredMatcher(comparison, expected);
                if (!preferred) {
                    return;
                }

                // toBeDefined() replaces `.not` too
                const matcher = comparison.matcher.property.name;
                const found =
                    preferred === 'toBeDefined' ? `not.${matcher}` : matcher;
                const value = context.sourceCode.getText(expected);
                context.report({
                    node: comparison.matcher.property,
                    message: `Use ${preferred}() rather than ${found}(${value})`,
                    fix: replaceMatcher(comparison, preferred)
                });
            }
        };
    }
};

export const preferToHaveLength: Rule = {
    meta: {
        type: 'suggestion',
        fixable: 'code',
        docs: {
            description:
                'Prefers expect(values).toHaveLength(n) to comparing expect(values.length) with n'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const comparison = comparisonOf(context, call);
                const [actual] = call.arguments;
                if (
                    comparison == null ||
                    call.arguments.length !== 1 ||
                    actual == null ||
                    !isNamedMember(actual, LENGTH)
                ) {
                    return;
                }

                const values = context.sourceCode.getText(actual.object);
                context.report({
                    node: actual,
                    message: `Use toHaveLength() rather than comparing ${values}.length`,
                    fix: fixer => [
                        fixer.replaceText(actual, values),
                        fixer.replaceText(
                            comparison.matcher.property,
                            'toHaveLength'
                        )
                    ]
                });
            }
        };
    }
};

export const noFocusedTests: Rule = {
    meta: {
        type: 'problem',
        hasSuggestions: true,
        docs: {
            description:
                'Disallows .only and the only option, which run the tests that they mark rather than every test'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const declaration = declarationOf(context, call);
                if (declaration == null) {
                    return;
                }

                const only = memberNamed(declaration, 'only');
                if (only != null) {
                    context.report({
                        node: only.property,
                        message:
                            'Expected every test to run, rather than those that .only marks',
                        suggest: [
                            {
                                desc: 'Remove .only',
                                fix: fixer =>
                                    fixer.removeRange([
                                        only.object.end,
                                        only.end
                                    ])
                            }
                        ]
                    });
                }

                const option = optionNamed(call, 'only');
                if (option != null) {
                    context.report({
                        node: option,
                        message:
                            'Expected every test to run, rather than those that the only option marks'
                    });
                }
            }
        };
    }
};

export const noDisabledTests: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallows .skip and the skip option, and tests without functions, which are to do unless marked so'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const declaration = declarationOf(context, call);
                if (declaration == null) {
                    return;
                }

                const kind = nameOfKind(declaration);
                const skip = memberNamed(declaration, 'skip');
                if (skip != null) {
                    context.report({
                        node: skip.property,
                        message: `Expected ${kind} to run, rather than be skipped with .skip`
                    });
                }

                const option = optionNamed(call, 'skip');
                if (option != null) {
                    context.report({
                        node: option,
                        message: `Expected ${kind} to run, rather than be skipped with the skip option`
                    });
                }

                if (
                    declaration.kind === 'test' &&
                    functionOf(call) == null &&
                    !isToDo(declaration)
                ) {
                    context.report({
                        node: call,
                        message:
                            "Expected the test to have a function, without which it's to do"
                    });
                }
            }
        };
    }
};

export const warnTodo: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallows .todo and the todo option, which mark tests that are to be written'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const declaration = declarationOf(context, call);
                if (declaration == null) {
                    return;
                }

                const kind = nameOfKind(declaration);
                const todo = memberNamed(declaration, 'todo');
                if (todo != null) {
                    context.report({
                        node: todo.property,
                        message: `Expected ${kind} to be written, rather than marked as to do with .todo`
                    });
                }

                const option = optionNamed(call, 'todo');
                if (option != null) {
                    context.report({
                        node: option,
                        message: `Expected ${kind} to be written, rather than marked as to do with the todo option`
                    });
                }
            }
        };
    }
};

export const validTitle: Rule = {
    meta: {
        type: 'problem',
        fixable: 'code',
        docs: {
            description:
                "Requires the title of a test or a describe block to have text, without spaces at its start or end, and not to start with the name that declares it, as in it('it works'). TypeScript checks that it's a string."
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const declaration = declarationOf(context, call);
                const title = declaration && titleOf(context, call);
                if (declaration == null || title == null) {
                    return;
                }

                if (title.cooked === '') {
                    context.report({
                        node: title.node,
                        message: 'Expected a title that has text'
                    });
                    return;
                }

                if (/^\s|\s$/.test(title.cooked)) {
                    reportSpaces(context, title);
                }
                if (startsWithWord(title.cooked, declaration.name)) {
                    reportPrefix(context, title, declaration.name);
                }
            }
        };
    }
};

export const validDescribeCallback: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Requires a describe block to pass a function written in place, which takes no parameters, unless it declares a block for each row, and returns nothing. It may be async, and its options may come before it.'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const declaration = declarationOf(context, call);
                if (declaration?.kind !== 'describe') {
                    return;
                }

                const callback = functionOf(call);
                if (callback == null) {
                    if (!isToDo(declaration)) {
                        context.report({
                            node: call.arguments[0] ?? call,
                            message:
                                'Expected a title and a function for the describe block'
                        });
                    }
                    return;
                }
                if (!isFunctionExpression(callback)) {
                    context.report({
                        node: callback,
                        message:
                            "Expected the describe block's function to be written in place"
                    });
                    return;
                }

                const forEachRow =
                    memberNamed(declaration, 'each') ??
                    memberNamed(declaration, 'for');
                if (forEachRow == null && callback.params.length > 0) {
                    context.report({
                        node: callback,
                        message:
                            "Expected the describe block's function to take no parameters"
                    });
                }

                const returned = returnOf(callback);
                if (returned != null) {
                    context.report({
                        node: returned,
                        message:
                            "Expected the describe block's function to return nothing"
                    });
                }
            }
        };
    }
};

export const noConditionalTests: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallows declaring tests and describe blocks in if statements, rather than skipping them on a condition with skipIf() or runIf()'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const declaration = declarationOf(context, call);
                if (declaration == null || !isInIfStatement(call)) {
                    return;
                }

                context.report({
                    node: call.callee,
                    message: `Expected ${nameOfKind(declaration)} to be declared unconditionally, rather than in an if statement: skipIf() and runIf() skip it on a condition`
                });
            }
        };
    }
};

export const validExpectInPromise: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Requires a promise whose callback calls expect(), as .then() does, to be awaited or returned, by itself or through the variable that holds it, so that the test waits for the assertion'
        }
    },
    create(context) {
        // A promise whose callbacks call expect() more than once is reported once
        const reported = new Set<CallExpression>();

        return {
            CallExpression(call): void {
                if (!isExpectCall(context, call)) {
                    return;
                }

                for (const promise of promisesAround(context, call)) {
                    if (
                        !reported.has(promise) &&
                        runsInTest(context, promise) &&
                        !isWaitedFor(context, promise)
                    ) {
                        reported.add(promise);
                        context.report({
                            node: promise,
                            message:
                                'Expected the promise whose callback calls expect() to be awaited or returned'
                        });
                    }
                }
            }
        };
    }
};

export const requireToThrowMessage: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Requires toThrow() and toThrowError() to be given what the error should be, such as its message, unless they follow .not'
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const chain = expectChainOf(context, call);
                const matcher = chain?.matcher;
                if (
                    chain == null ||
                    matcher == null ||
                    chain.matcherCall?.arguments.length !== 0 ||
                    !THROW_MATCHERS.has(matcher.property.name) ||
                    hasModifier(chain, NOT)
                ) {
                    return;
                }

                context.report({
                    node: matcher.property,
                    message: `Expected ${matcher.property.name}() to be given what the error should be, such as its message`
                });
            }
        };
    }
};

export const requireMockTypeParameters: Rule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Requires a vi.fn() without an implementation to be given the type of the function that it mocks, in TypeScript'
        }
    },
    create(context) {
        if (!TYPESCRIPT.test(context.filename)) {
            return {};
        }

        return {
            CallExpression(call): void {
                const method = viMethodOf(context, call);
                if (method?.property.name !== 'fn' || call.typeArguments) {
                    return;
                }

                // An implementation gives the mock its type
                if (call.arguments.length > 0) {
                    return;
                }

                context.report({
                    node: method.property,
                    message:
                        'Expected vi.fn() to be given the type of the function that it mocks, as in vi.fn<() => void>()'
                });
            }
        };
    }
};

export const hoistedApisOnTop: Rule = {
    meta: {
        type: 'problem',
        hasSuggestions: true,
        docs: {
            description:
                "Requires vi.mock(), vi.unmock() and vi.hoisted() to be called in statements of their own at the module's top level, which hypotes/register hoists them from"
        }
    },
    create(context) {
        return {
            CallExpression(call): void {
                const method = viMethodOf(context, call);
                const name = method?.property.name;
                if (
                    method == null ||
                    name == null ||
                    !HOISTED_METHODS.has(name) ||
                    isHoistable(call, name)
                ) {
                    return;
                }

                context.report({
                    node: call,
                    message: `Expected vi.${name}() in a statement of its own at the module's top level: it's hoisted above the module's code`,
                    suggest: hoistingSuggestions(context, call, method)
                });
            }
        };
    }
};
