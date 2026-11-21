// A file whose test a module of another package declares, for
// `reporter.test.ts`
import { declare } from './lib/declare.ts';

declare('is declared elsewhere');
