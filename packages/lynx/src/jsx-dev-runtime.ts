/**
 * Dev-mode JSX runtime — same snapshot slot rewrite as jsx-runtime.ts
 * (runtime-core's jsxDEV is an alias of jsx). The wrapper carries the full
 * react-jsxdev arity so consumers typecheck; the extra dev args are unused.
 */

import { Fragment, jsx } from './jsx-runtime.js';

export function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
  key?: string,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): unknown {
  return jsx(type, props, key);
}

export { Fragment };
