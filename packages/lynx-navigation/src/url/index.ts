/**
 * URL bridge — internal barrel.
 *
 * Not re-exported from the package root. Public surface is `hrefFor` /
 * `parseHref` in ../href.ts plus `_setRouteRegistry` for tests/bootstrap.
 */

export { compilePath, type CompiledPath } from './compile.js';
export { buildUrl } from './build.js';
export { parseHrefImpl } from './parse.js';
export { formatSearch, parseSearch } from './format.js';
export {
    _setRouteRegistry,
    _clearRouteRegistry,
    getRouteRegistry,
    getCompiledPath,
} from './registry.js';
export { validateSync, type ValidateOutcome } from './validate.js';
