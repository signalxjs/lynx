import { registerIconSet } from './registry';
import type { IconSetDef } from './types';

/**
 * Register a custom icon set at module load time.
 *
 * Build-time sets declared in `sigx.lynx.config.ts` are auto-detected and
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
 *         svg: '<svg viewBox="0 0 24 24" fill="__COLOR__"><path d="M3 12L12 3l9 9-9 9z"/></svg>',
 *       },
 *     },
 *   },
 * });
 * ```
 *
 * The inner `svg` value is raw SVG markup. `__COLOR__` placeholders in that
 * markup get substituted with the user's `color` prop at render time.
 */
export function defineIconSet(def: IconSetDef): IconSetDef {
    registerIconSet(def);
    return def;
}

export type { IconSetDef } from './types';
