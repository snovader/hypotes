// A module that imports a package that isn't installed, which gets its mock
// @ts-expect-error -- Only the mock of the package is there
export { missing } from 'not-installed-package';
