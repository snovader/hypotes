// A module that imports `cycle.ts`, which imports it
// oxlint-disable-next-line import/no-cycle -- The cycle that the test needs
import { forth } from './cycle.ts';

export function back(): string {
    return 'back';
}

export function round(): string {
    return forth();
}
