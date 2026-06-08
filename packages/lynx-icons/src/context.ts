import { defineInjectable } from '@sigx/lynx';
import type { IconColorResolver } from './types.js';

/**
 * Injectable DI key for the active theme's icon-color resolver.
 *
 * Lives in this **CSS-free** module — no `Icon`, no `__font-face.css` /
 * `__svgs` / `__codepoints` side-effect imports — so the theme engine
 * (`@sigx/lynx-zero`'s `<ThemeProvider>`) can provide the resolver via
 * `defineProvide(useIconColorResolver, …)` without eagerly pulling the icon
 * assets into its barrel. Reach it from the `@sigx/lynx-icons/context` subpath.
 *
 * Core `<Icon>` reads it (`./Icon.tsx`); a theme provides it. With no provider
 * it defaults to `null` and the icon falls through to `props.color` /
 * `currentColor`.
 */
export const useIconColorResolver = defineInjectable<IconColorResolver | null>(() => null);

export type { IconColorResolver, IconPropsExtensions } from './types.js';
