/**
 * JSX type augmentation for the `show` directive — adds `use:show` to
 * JSX.DirectiveAttributeExtensions so typing `use:` in JSX suggests it and the
 * bound value is type-checked as a boolean. No runtime exports.
 */
import type { DirectiveAttribute } from '../jsx.js';

export {};

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
