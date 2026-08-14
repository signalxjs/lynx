/**
 * `@sigx/runtime-dom/platform` counterpart (#1059) — the web entry imports
 * this subpath for its side effects (DOM platform bootstrapping) before
 * anything else, so the alias target must expose it or ESM resolution dies
 * at `Package subpath './platform' is not defined`. On lynx the platform is
 * bootstrapped by the runtime wrapper and the element registry — there is
 * nothing to do here, and this module intentionally does nothing.
 */
export {};
