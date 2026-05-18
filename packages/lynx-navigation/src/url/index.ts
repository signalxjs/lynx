/**
 * URL bridge — internal barrel.
 *
 * Not re-exported from the package root. Public surface is `hrefFor` /
 * `parseHref` in ../href.ts plus `_setRouteRegistry` for tests/bootstrap.
 */

export { compilePath, type CompiledPath } from './compile';
export { buildUrl } from './build';
export { parseHrefImpl } from './parse';
export { formatSearch, parseSearch } from './format';
export {
    _setRouteRegistry,
    _clearRouteRegistry,
    getRouteRegistry,
    getCompiledPath,
} from './registry';
export { validateSync, type ValidateOutcome } from './validate';
