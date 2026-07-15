/**
 * Dev-mode JSX runtime — same snapshot slot rewrite as jsx-runtime.ts
 * (runtime-core's jsxDEV is an alias of jsx, so the wrapper is shared).
 */

export { Fragment, jsx as jsxDEV } from './jsx-runtime.js';
