/**
 * The contract surface of lynx-zero: `@sigx/zero`'s portable contract
 * re-exported verbatim (this package defines NO parallel vocabulary — one
 * contract, one source), plus the two lynx-specific seams: `partBag` (one
 * descriptor → class list + data attrs) and `partA11y` (the five-prop native
 * accessibility mapping).
 */

// The vocabularies, token contract, anatomy machinery, variant pass-through
// and the class grammar — everything a non-DOM runtime consumes, from the
// published DOM-free subpath.
export * from '@sigx/zero/contract/core';

export type { LynxPartProps, PartBagOptions } from './part.js';
export { partBag } from './part.js';
export type { PartA11yOptions } from './a11y.js';
export { partA11y } from './a11y.js';
