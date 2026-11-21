// Preloaded with `node --import hypotes/register`, which node:test passes on
// to the process of each test file: installs the module mocks of `vi`, and
// hoists them above the imports of each module that calls `vi.mock()`, as
// Vitest does
import { registerHooks } from 'node:module';
import { hoistModule } from './hoist.ts';
import { ModuleMocks } from './mocks.ts';

const mocks = ModuleMocks.install();

// Unless another copy of this package installed its own
if (mocks != null) {
    registerHooks({
        resolve: (specifier, context, nextResolve) =>
            mocks.resolve(specifier, context, nextResolve),
        load: (url, context, nextLoad) =>
            hoistModule(url, mocks.load(url, context, nextLoad))
    });
}
