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
 *     logo: { svg: { w: 24, h: 24, path: 'M3 12...' } },
 *   },
 * });
 * ```
 */
export function defineIconSet(def: IconSetDef): IconSetDef {
    registerIconSet(def);
    return def;
}

export type { IconSetDef } from './types';
