// A faster path through the deep equality of `toEqual` and `toStrictEqual`,
// which @vitest/expect's `equals` computes with a generic recursion: at each
// value it runs the asymmetric matchers and every tester, lists keys with
// `for...in`, and compares typed arrays element by element after listing
// their keys. This tester runs first, as a custom tester, and answers for the
// plain objects, arrays, typed arrays and primitives that it reaches, with
// the result that `equals` would give, but for what tests rarely hold, whose
// keys only listing them finds, which takes most of the time on large arrays:
// it compares arrays and typed arrays by their elements alone, not by other
// properties set on them, and objects by their string keys, not their symbol
// keys. Anything else, such as a Map or an asymmetric matcher, it leaves to
// `equals`, which calls it again for what's inside.
//
// A tester gets the testers of the matcher, but not whether `equals` compares
// strictly, and the two don't always go together: an asymmetric matcher in
// `toStrictEqual` compares what's inside it with those testers, but not
// strictly. So this tester answers only where both give the same result, and
// leaves the rest to `equals`: a key whose value is undefined, which the
// other object lacks, and, with the testers of `toEqual`, a hole in an array
// where the other has undefined.
import { Buffer } from 'node:buffer';
import {
    arrayBufferEquality,
    getCustomEqualityTesters,
    isAsymmetric,
    iterableEquality,
    sparseArrayEquality,
    typeEquality,
    type Tester
} from '@vitest/expect';

/**
 * Nesting past which the tester leaves values to `equals`, which tells
 * cycles from deep values
 */
const MAX_DEPTH = 256;

type TypedArray =
    | BigInt64Array
    | BigUint64Array
    | Float16Array
    | Float32Array
    | Float64Array
    | Int8Array
    | Int16Array
    | Int32Array
    | Uint8Array
    | Uint8ClampedArray
    | Uint16Array
    | Uint32Array;

/**
 * Whether `a` and `b` are equal as `equals` compares them with the testers
 * of `toEqual` or of `toStrictEqual`, strictly or not, or undefined to leave
 * them to `equals`. It leaves them all to it with testers of other matchers,
 * such as `toMatchObject`, or other custom testers, whose results it couldn't
 * know.
 */
export const fastEquality: Tester = function (a, b, customTesters) {
    const strict = strictnessOf(customTesters);
    return strict == null ? undefined : compare(a, b, strict, 0);
};

/**
 * Whether the testers are those of `toStrictEqual`, which compare
 * constructors and tell holes from undefined, rather than `toEqual`, or
 * undefined if they're another matcher's
 */
function strictnessOf(customTesters: readonly Tester[]): boolean | undefined {
    const added = getCustomEqualityTesters();
    if (added.length !== 1 || customTesters[0] !== fastEquality) {
        return undefined;
    }

    if (customTesters.length === 2 && customTesters[1] === iterableEquality) {
        return false;
    }

    const isStrict =
        customTesters.length === 5 &&
        customTesters[1] === iterableEquality &&
        customTesters[2] === typeEquality &&
        customTesters[3] === sparseArrayEquality &&
        customTesters[4] === arrayBufferEquality;
    return isStrict ? true : undefined;
}

function compare(
    a: unknown,
    b: unknown,
    strict: boolean,
    depth: number
): boolean | undefined {
    if (!isObject(a) || !isObject(b)) {
        if (Object.is(a, b)) {
            return true;
        }

        // A primitive or a function equals only itself, unless an asymmetric
        // matcher matches it
        return isAsymmetric(a) || isAsymmetric(b) ? undefined : false;
    }

    if (depth > MAX_DEPTH || isAsymmetric(a) || isAsymmetric(b)) {
        return undefined;
    }

    if (Array.isArray(a)) {
        return Array.isArray(b) ? compareArrays(a, b, strict, depth) : false;
    }

    if (isTypedArray(a)) {
        return isTypedArray(b) && a.constructor === b.constructor
            ? compareTypedArrays(a, b)
            : undefined;
    }

    if (isPlainObject(a) && isPlainObject(b)) {
        return compareObjects(a, b, strict, depth);
    }

    return undefined;
}

function isObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null;
}

function isTypedArray(value: object): value is TypedArray {
    return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

/**
 * Whether `equals` compares the value by its own keys alone: an object of
 * Object's tag, whatever its prototype, that isn't iterable or an error
 */
function isPlainObject(value: object): value is Record<string, unknown> {
    return (
        Object.prototype.toString.call(value) === '[object Object]' &&
        !(Symbol.iterator in value) &&
        !Error.isError(value)
    );
}

/**
 * Objects of the same constructor, if strict, with the same own enumerable
 * string keys, and equal values at them. Where the keys that only one of
 * them has all have undefined values, they're equal unless `equals` compares
 * strictly, which is left to it.
 */
function compareObjects(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    strict: boolean,
    depth: number
): boolean | undefined {
    if (a === b) {
        return true;
    }

    if (strict && a.constructor !== b.constructor) {
        return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    let sameKeys = aKeys.length === bKeys.length;
    for (const key of aKeys) {
        const value = a[key];
        if (Object.hasOwn(b, key)) {
            const equal = compare(value, b[key], strict, depth + 1);
            if (!equal) {
                return equal;
            }
        } else if (value === undefined) {
            sameKeys = false;
        } else {
            return false;
        }
    }

    if (sameKeys) {
        return true;
    }

    return hasDefinedKeyMissingFrom(b, bKeys, a) ? false : undefined;
}

/** Whether a key of the object has a value other than undefined, and the other lacks it */
function hasDefinedKeyMissingFrom(
    object: Record<string, unknown>,
    keys: readonly string[],
    other: object
): boolean {
    for (const key of keys) {
        if (!Object.hasOwn(other, key) && object[key] !== undefined) {
            return true;
        }
    }

    return false;
}

/**
 * Arrays of the same constructor, if strict, and length, with equal elements.
 * A hole is missing, which the testers of `toStrictEqual` tell from
 * undefined. With those of `toEqual`, the two are equal unless `equals`
 * compares strictly, which is left to it.
 */
function compareArrays(
    a: unknown[],
    b: unknown[],
    strict: boolean,
    depth: number
): boolean | undefined {
    if (a === b) {
        return true;
    }

    if ((strict && a.constructor !== b.constructor) || a.length !== b.length) {
        return false;
    }

    for (let index = 0; index < a.length; index++) {
        const value = a[index];
        const other = b[index];
        // Equal primitives, but -0 and 0, which `===` takes as equal
        if (value === other && typeof value !== 'object' && value !== 0) {
            if (value === undefined && index in a !== index in b) {
                return strict ? false : undefined;
            }
            continue;
        }

        const equal = compare(value, other, strict, depth + 1);
        if (!equal) {
            return equal;
        }
    }

    return true;
}

/**
 * Typed arrays of the same constructor and length, with equal elements, as
 * `Object.is` compares them. Equal bytes make equal elements; a float array's
 * elements can be equal with other bytes, as NaNs.
 */
function compareTypedArrays(a: TypedArray, b: TypedArray): boolean {
    if (a.length !== b.length) {
        return false;
    }

    if (a === b || Buffer.compare(bytesOf(a), bytesOf(b)) === 0) {
        return true;
    }

    const isFloat =
        a instanceof Float64Array ||
        a instanceof Float32Array ||
        a instanceof Float16Array;
    return isFloat && haveSameElements(a, b);
}

function bytesOf(array: TypedArray): Uint8Array {
    return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function haveSameElements(a: TypedArray, b: TypedArray): boolean {
    for (let index = 0; index < a.length; index++) {
        if (!Object.is(a[index], b[index])) {
            return false;
        }
    }

    return true;
}
