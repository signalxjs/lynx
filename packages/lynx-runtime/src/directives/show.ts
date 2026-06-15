/**
 * Built-in `show` directive — toggles element visibility via `display`.
 *
 * Unlike conditional rendering (`{cond && <view/>}`, which unmounts and
 * remounts the subtree — a burst of cross-thread create/insert/remove ops),
 * `use:show` keeps the element mounted and toggles a single `SET_STYLE` op.
 * Useful when toggling is frequent or you want to preserve element state
 * (input focus/value, scroll position, an expensive subtree).
 *
 * Tradeoff: a hidden subtree stays mounted as live native views — it still
 * costs memory. Reach for conditional rendering when the hidden branch is
 * large and rarely shown.
 *
 * The element's own `display` (or lack of one) is preserved: lynx keeps the
 * raw user style in `ShadowElement._style`, so un-hiding re-applies exactly
 * what the user set — no need to capture/restore an "original display" the way
 * the DOM directive does.
 *
 * @example
 * ```tsx
 * // Shorthand — `show` is registered with the platform automatically:
 * <view use:show={isOpen.value}>Content</view>
 *
 * // Explicit tuple form:
 * import { show } from '@sigx/lynx';
 * <view use:show={[show, isOpen.value]}>Content</view>
 * ```
 */
import { defineDirective } from '@sigx/runtime-core';
import type { ShadowElement } from '../shadow-element.js';
import { applyElementVisibility } from '../nodeOps.js';

export const show = defineDirective<boolean, ShadowElement>({
  mounted(el, { value }) {
    applyElementVisibility(el, !!value);
  },

  updated(el, { value, oldValue }) {
    if (value !== oldValue) applyElementVisibility(el, !!value);
  },

  unmounted(el) {
    // The element is being removed; just reset the flag (no style op needed —
    // a fresh ShadowElement starts visible, and cloneNode makes new nodes).
    el._vShowHidden = false;
  },
});
