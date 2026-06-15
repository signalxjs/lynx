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
import type { DirectiveAttribute } from '../jsx.js';
import { applyElementVisibility } from '../nodeOps.js';

export const show = defineDirective<boolean, ShadowElement>({
  mounted(el, { value }) {
    applyElementVisibility(el, !!value);
  },

  updated(el, { value, oldValue }) {
    if (value !== oldValue) applyElementVisibility(el, !!value);
  },

  unmounted(el) {
    // Restore visibility. This fires both when the element is removed (a cheap
    // extra op before its REMOVE) and — importantly — when the `use:show` prop
    // is removed while the element stays mounted, where the last pushed style
    // still carries display:none and must be cleared.
    applyElementVisibility(el, true);
  },
});

// JSX type augmentation — adds `use:show` to the directive IntelliSense seam.
// Lives here (alongside the runtime) rather than in a separate type-only module
// so the augmentation rides this already-imported value module — no extra
// runtime side-effect import just to carry types.
declare global {
    namespace JSX {
        interface DirectiveAttributeExtensions {
            /**
             * Toggle element visibility via `display`. The element stays
             * mounted — only its `display` is toggled (one style op vs an
             * unmount/remount), preserving its state.
             *
             * Tradeoff: a hidden subtree stays mounted as live native views.
             * Prefer conditional rendering for large, rarely-shown branches.
             *
             * @example
             * ```tsx
             * <view use:show={isVisible.value}>Content</view>
             * ```
             */
            'use:show'?: DirectiveAttribute<boolean>;
        }
    }
}
