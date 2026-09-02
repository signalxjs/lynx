import { registerIconSet } from './registry.js';
import type { IconSetDef } from './types.js';

/**
 * Register a custom icon set at module load time.
 *
 * Build-time sets declared in `signalx.config.ts` are auto-detected and
 * tree-shaken; `defineIconSet` is the escape hatch for ad-hoc sets defined
 * directly in app code (e.g. a small private set used in one screen).
 *
 * @example
 * ```ts
 * defineIconSet({
 *   id: 'brand',
 *   glyphs: {
 *     logo: {
 *       svg: {
 *         svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 12L12 3l9 9-9 9z"/></svg>',
 *       },
 *     },
 *   },
 * });
 * ```
 *
 * The inner `svg` value is standard SVG markup painting from `currentColor`;
 * the user's `color` prop reaches it through the native `current-color`
 * attribute (Lynx 4.0+) or, on web, by substitution into the markup. The
 * older `__COLOR__` placeholder is still honored as an alias.
 */
export function defineIconSet(def: IconSetDef): IconSetDef {
    registerIconSet(def);
    return def;
}

export type { IconSetDef } from './types.js';
