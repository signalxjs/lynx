// @sigx/lynx-list — high-performance virtualized list for sigx-lynx.
//
// A data-driven wrapper over the native Lynx `<list>` recycler: grid/waterfall
// layouts, header/footer/empty slots, edge-reached events and an imperative
// scroll API. Only on-screen cells exist as native views, so it scales to long
// feeds and grids.

export { List } from './List.js';
export { ListMethods } from './methods.js';
export type { ScrollToIndexOptions } from './methods.js';
export type {
  ListProps,
  ListRef,
  ListType,
  ListItemSnap,
  ScrollAlign,
} from './types.js';
