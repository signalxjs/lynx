/**
 * Module augmentation for Lynx platform.
 *
 * Sets `PlatformTypes.element = ShadowElement` so generic helpers in
 * @sigx/runtime-core that read the per-platform element type pick up
 * our shadow tree node.
 *
 * Mirrors packages/runtime-terminal/src/types.ts exactly.
 */

import type { ShadowElement } from './shadow-element.js';

declare module '@sigx/runtime-core' {
    /** Lynx platform sets ShadowElement as the default element type */
    interface PlatformTypes {
        element: ShadowElement;
    }
}

// Make this a module so the augmentation applies on import.
export {};
