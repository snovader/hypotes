// A module that imports a module that imports it back, which the tests of
// automocking mock
// oxlint-disable-next-line import/no-cycle -- The cycle that the test needs
import { back } from './cycle-back.ts';

export function forth(): string {
    return `forth ${back()}`;
}
