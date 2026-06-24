import { component, useElementLayout } from '@sigx/lynx';
import type { ListProps } from './types.js';

// Reserved item-keys for the optional header/footer cells. Prefixed so they
// never collide with a consumer's keyExtractor output.
const HEADER_KEY = '__sigx_list_header__';
const FOOTER_KEY = '__sigx_list_footer__';

type ScrollDetail = { detail?: { scrollTop?: number; scrollLeft?: number } };

/**
 * `<List>` — a data-driven, virtualized list built on Lynx's native `<list>`
 * recycler. Only on-screen cells exist as native views regardless of how many
 * items are passed, so it stays smooth for long feeds and grids.
 *
 * ## Sizing
 * The native `<list>` only lays out with a **concrete** main-axis size
 * (flex/percent resolve to zero → nothing renders). So `class`/`style` land on
 * a measuring wrapper `<view>` (where flex sizing works as usual — e.g.
 * `style={{ flexGrow: 1 }}` inside a column), the wrapper measures itself via
 * `bindlayoutchange`, and the list is pinned to the measured px. The list
 * stays mounted from the first render (a 1px placeholder until the measure
 * lands — `bindlayoutchange` never fires on a childless view, so conditionally
 * mounting on the measured size would deadlock at 0). First paint is one frame
 * after mount. Same pattern as `EmojiGrid` in `@sigx/lynx-emoji`.
 *
 * @example
 * ```tsx
 * <List
 *   items={messages}
 *   keyExtractor={(m) => m.id}
 *   renderItem={(m) => <MessageRow message={m} />}
 *   style={{ flexGrow: 1 }}
 *   onEndReached={() => loadMore()}
 * />
 * ```
 */
const ListImpl = component<ListProps>(({ props, slots, emit }) => {
  const { layout, onLayoutChange } = useElementLayout();

  return () => {
    const horizontal = props.horizontal ?? false;
    const items = props.items;
    const count = items.length;

    // Pin the list to the measured main-axis size; 1px placeholder until the
    // wrapper's first layout pass lands.
    const measured = horizontal ? layout.value?.width : layout.value?.height;
    const mainAxisPx = measured && measured > 0 ? `${measured}px` : '1px';
    const listStyle: Record<string, string | number> = horizontal
      ? { width: mainAxisPx, height: '100%' }
      : { height: mainAxisPx, width: '100%' };

    const keyOf = props.keyExtractor;
    const typeOf = props.itemType;
    const estimated = props.estimatedItemSize;

    // Empty state replaces the list body (the wrapper still has a child, so it
    // keeps measuring and the list can mount once items arrive).
    const showEmpty = count === 0 && !!slots.empty;

    return (
      <view
        class={props.class}
        style={props.style}
        bindlayoutchange={onLayoutChange}
      >
        {showEmpty ? (
          slots.empty?.()
        ) : (
          <list
            style={listStyle}
            scroll-orientation={horizontal ? 'horizontal' : 'vertical'}
            list-type={props.listType ?? 'single'}
            span-count={props.numColumns ?? 1}
            item-snap={props.itemSnap}
            main-thread:ref={props.mtRef}
            lower-threshold-item-count={props.onEndReachedThreshold}
            upper-threshold-item-count={props.onStartReachedThreshold}
            scroll-event-throttle={props.scrollEventThrottle}
            bindscrolltolower={() => emit('endReached')}
            bindscrolltoupper={() => emit('startReached')}
            bindscroll={(e: ScrollDetail) => {
              const d = e?.detail;
              if (!d) return;
              emit('scroll', { offset: (horizontal ? d.scrollLeft : d.scrollTop) ?? 0 });
            }}
          >
            {slots.header && (
              <list-item item-key={HEADER_KEY} item-type="__header" full-span key={HEADER_KEY}>
                {slots.header()}
              </list-item>
            )}
            {items.map((item, i) => {
              const key = keyOf ? keyOf(item, i) : String(i);
              return (
                <list-item
                  key={key}
                  item-key={key}
                  item-type={typeOf ? typeOf(item, i) : 'item'}
                  estimated-main-axis-size-px={estimated}
                >
                  {props.renderItem(item, i)}
                </list-item>
              );
            })}
            {slots.footer && (
              <list-item item-key={FOOTER_KEY} item-type="__footer" full-span key={FOOTER_KEY}>
                {slots.footer()}
              </list-item>
            )}
          </list>
        )}
      </view>
    );
  };
});

// `component()` transforms the prop markers (`Define.Slot`/`Define.Event`) into
// the real JSX surface (`slots`, `onEndReached`, …). Re-type only `items` /
// `renderItem` generically over the item type `T` so callers get inference
// (`<List items={messages} renderItem={(m) => …} />`) while keeping the
// transformed slots/events intact — the plain `<T>(props: ListProps<T>)` cast
// used by `Swiper` would drop both (it has no slots and uses signals, not
// events; this list needs both).
type ListJsxProps = Parameters<typeof ListImpl>[0];

/** {@inheritDoc ListImpl} */
export const List = ListImpl as unknown as <T>(
  props: Omit<ListJsxProps, 'items' | 'renderItem' | 'keyExtractor' | 'itemType'> & {
    items: readonly T[];
    renderItem: (item: T, index: number) => unknown;
    keyExtractor?: (item: T, index: number) => string;
    itemType?: (item: T, index: number) => string;
  },
) => unknown;
