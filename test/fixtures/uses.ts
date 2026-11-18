// A module that imports `values.ts`, which gets its mock
import { double } from './values.ts';

export function quadruple(value: number): number {
    return double(double(value));
}
