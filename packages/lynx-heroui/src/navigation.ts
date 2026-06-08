// @sigx/lynx-heroui/navigation — navigation chrome that statically imports the
// optional `@sigx/lynx-navigation` peer. Kept OFF the root barrel so importing
// `@sigx/lynx-heroui` never forces navigation resolution (same pattern as
// `@sigx/lynx-zero/screen-theme`). Apps using these install the peer and import
// from this subpath:
//
//   import { NavHeader, NavTabBar } from '@sigx/lynx-heroui/navigation';
export { NavHeader } from './components/NavHeader.js';
export type { NavHeaderProps, NavHeaderBackground } from './components/NavHeader.js';
export { NavTabBar } from './components/NavTabBar.js';
export type {
  NavTabBarProps,
  NavTabBarPosition,
  NavTabBarBackground,
  NavTabRenderContext,
} from './components/NavTabBar.js';
