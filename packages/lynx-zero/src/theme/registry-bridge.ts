/**
 * The registry and the theme-class grammar, from one place: theme METADATA
 * is zero's own registry (`@sigx/zero/theme/registry` — the same module the
 * web runtime uses; a design-system package seeds it at load with
 * `registerThemes(tokens)`), and the class a selection renders is the shared
 * grammar's `zx-theme-<name>` from `@sigx/zero/contract/core`.
 */
export type { ThemeInfo, ThemeSource } from '@sigx/zero/theme/registry';
export {
    getTheme,
    listThemes,
    pairOf,
    pickThemeFor,
    registerTheme,
    registerThemes,
} from '@sigx/zero/theme/registry';
export { HOST_CLASS, themeClass } from '@sigx/zero/contract/core';
