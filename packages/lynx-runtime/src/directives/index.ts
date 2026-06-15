/**
 * Directive runtime for Lynx — element-level `use:*` directives.
 *
 * Wires runtime-core's directive lifecycle into lynx's renderer. Mirrors
 * `@sigx/runtime-dom`'s directive runtime, adapted for the background-thread
 * `ShadowElement` / op-based renderer (no DOM nodes, no `addEventListener`).
 *
 * runtime-core's renderer drives the lifecycle through the `RendererOptions`
 * hooks lynx wires up in `nodeOps`:
 *   - a `use:<name>` prop  → `patchDirective` (created on first sight,
 *     updated when the bound value changes),
 *   - after the element is inserted → `onElementMounted` (mounted hooks),
 *   - before the element is removed → `onElementUnmounted` (unmounted hooks
 *     + state cleanup).
 *
 * Directives are resolved from the prop value (an imported definition or an
 * explicit `[definition, value]` tuple) or, for the shorthand
 * `use:name={value}`, by name — first from the built-in registry (e.g. `show`),
 * then from `app.directive()` registrations on the app context.
 */
import { isDirective, type DirectiveDefinition } from '@sigx/runtime-core';
import type { AppContext } from '@sigx/runtime-core';
import type { ShadowElement } from '../shadow-element.js';

/**
 * A directive definition narrowed to lynx's `ShadowElement` host — the
 * counterpart to runtime-dom's `DOMDirective`.
 *
 * @example
 * ```ts
 * import { defineDirective, type LynxDirective } from '@sigx/lynx';
 *
 * const autofocus: LynxDirective<boolean> = defineDirective({
 *   mounted(el, { value }) { if (value) // ...focus el }
 * });
 * ```
 */
export type LynxDirective<T = any> = DirectiveDefinition<T, ShadowElement>;

/** Per-directive state stored on a {@link ShadowElement}. @internal */
export interface DirectiveState {
  def: DirectiveDefinition;
  value: any;
}

/**
 * Registry of built-in directives by name. A `use:<name>` prop with a plain
 * value (not a directive definition) is resolved here first.
 * @internal
 */
const builtInDirectives = new Map<string, DirectiveDefinition>();

/**
 * Register a directive globally so it works with the shorthand
 * `<view use:show={value}>` instead of the explicit
 * `<view use:show={[show, value]}>` tuple. The seam for directive packs;
 * per-app `app.directive(name, def)` is preferred when an app context exists.
 */
export function registerBuiltInDirective(name: string, def: DirectiveDefinition): void {
  builtInDirectives.set(name, def);
}

/** Look up a registered built-in directive by name. @internal */
export function resolveBuiltInDirective(name: string): DirectiveDefinition | undefined {
  return builtInDirectives.get(name);
}

function getDirectiveMap(el: ShadowElement): Map<string, DirectiveState> {
  let map = el._directives;
  if (!map) {
    map = new Map();
    el._directives = map;
  }
  return map;
}

/**
 * Process a `use:*` prop — handles the `created` and `updated` lifecycle hooks.
 * Called by `nodeOps.patchDirective` (which the renderer invokes for `use:`
 * props during mount and patch).
 * @internal
 */
export function patchDirective(
  el: ShadowElement,
  name: string,
  _prevValue: unknown,
  nextValue: unknown,
  appContext: AppContext | null,
): void {
  if (nextValue == null) {
    // Directive removed from a still-mounted element — run its `unmounted` hook
    // now and drop the state. (onElementUnmounted only fires when the *element*
    // is removed; without this, e.g. removing `use:show` would leave the element
    // hidden / stale.)
    const map = el._directives;
    const removed = map?.get(name);
    if (removed) {
      removed.def.unmounted?.(el, { value: removed.value });
      map!.delete(name);
      if (map!.size === 0) el._directives = undefined;
    }
    return;
  }

  // Resolve the directive definition + binding value from the prop value:
  //   use:name={def}          → def, value=undefined
  //   use:name={[def, value]} → def[0], value=def[1]
  //   use:name={value}        → resolve `name` (built-in, then app.directive)
  let def: DirectiveDefinition;
  let value: any;

  if (isDirective(nextValue)) {
    def = nextValue;
    value = undefined;
  } else if (
    Array.isArray(nextValue) &&
    nextValue.length >= 1 &&
    isDirective(nextValue[0])
  ) {
    def = nextValue[0];
    value = nextValue[1];
  } else {
    const builtIn = builtInDirectives.get(name);
    if (builtIn) {
      def = builtIn;
      value = nextValue;
    } else {
      const custom = appContext?.directives.get(name);
      if (custom) {
        def = custom;
        value = nextValue;
      } else {
        // Reach for process via globalThis so the package doesn't pull in
        // @types/node just for a dev-mode warning (matches SharedValue).
        const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env?.['NODE_ENV'];
        if (env !== 'production') {
          console.warn(
            `[sigx] Directive "use:${name}" could not be resolved. ` +
              `Register it via app.directive('${name}', definition) or pass a directive definition directly.`,
          );
        }
        return;
      }
    }
  }

  // Resolution succeeded — only now allocate the per-element directive map (an
  // unresolved/typo'd directive returns above without retaining an empty Map).
  const dirMap = getDirectiveMap(el);
  const existing = dirMap.get(name);
  if (!existing) {
    // First time — call created hook.
    dirMap.set(name, { def, value });
    def.created?.(el, { value });
  } else {
    // Update — call updated hook when the bound value changed.
    const oldValue = existing.value;
    existing.def = def;
    existing.value = value;
    if (value !== oldValue) {
      def.updated?.(el, { value, oldValue });
    }
  }
}

/**
 * Invoke `mounted` hooks for every directive on an element, after it is
 * inserted. Called by `nodeOps.onElementMounted`.
 * @internal
 */
export function onElementMounted(el: ShadowElement): void {
  const map = el._directives;
  if (!map) return;
  for (const [, state] of map) {
    state.def.mounted?.(el, { value: state.value });
  }
}

/**
 * Invoke `unmounted` hooks for every directive on an element and clear its
 * directive state, before the element is removed. Called by
 * `nodeOps.onElementUnmounted`.
 * @internal
 */
export function onElementUnmounted(el: ShadowElement): void {
  const map = el._directives;
  if (!map) return;
  for (const [, state] of map) {
    state.def.unmounted?.(el, { value: state.value });
  }
  map.clear();
  el._directives = undefined;
}
