// @sigx/lynx-daisyui/navigation — navigation chrome that statically imports the
// optional `@sigx/lynx-navigation` peer. Kept OFF the root barrel so importing
// `@sigx/lynx-daisyui` never forces navigation resolution (same pattern as
// `@sigx/lynx-heroui/navigation`). Apps using these install the peer and import
// from this subpath:
//
//   import { NavHeader, NavTabBar, NavDrawer } from '@sigx/lynx-daisyui/navigation';
export { NavTabBar } from './navigation/NavTabBar.js';
export type {
    NavTabBarProps,
    NavTabBarPosition,
    NavTabBarBackground,
    NavTabRenderContext,
} from './navigation/NavTabBar.js';
export { NavHeader } from './navigation/NavHeader.js';
export type {
    NavHeaderProps,
    NavHeaderBackground,
} from './navigation/NavHeader.js';
export { NavDrawer } from './navigation/NavDrawer.js';
export type {
    NavDrawerProps,
    NavDrawerSide,
} from './navigation/NavDrawer.js';
