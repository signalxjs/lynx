import { describe, it, expect, vi } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { render, getByType, getAllByType, getByText, queryByText, act } from '@sigx/lynx-testing';
import { List } from '../src/List';

interface Row { id: string; text: string }
const ITEMS: Row[] = [
  { id: 'a', text: 'Alpha' },
  { id: 'b', text: 'Beta' },
  { id: 'c', text: 'Gamma' },
];

const renderRow = (it: Row) => <text>{it.text}</text>;

// Find the measuring wrapper and fire a layout pass so chat mode's first-paint
// scroll-to-bottom completes (which un-gates stick-to-bottom).
function fireLayout(container: { findAllByType(t: string): { _handlers: Map<string, Function> }[] }, height = 500): void {
  const wrapper = container
    .findAllByType('view')
    .find((v) => v._handlers.has('bindlayoutchange'))!;
  wrapper._handlers.get('bindlayoutchange')!({
    detail: { width: 320, height, top: 0, left: 0, right: 320, bottom: height },
  });
}

describe('List', () => {
  it('wraps a native <list> in a measuring <view>, vertical by default', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    const wrapper = container.children[0];
    expect(wrapper.type).toBe('view');
    expect(wrapper._handlers.has('bindlayoutchange')).toBe(true);

    const list = getByType(container, 'list');
    expect(list.props['scroll-orientation']).toBe('vertical');
    expect(list.props['list-type']).toBe('single');
    expect(list.props['span-count']).toBe(1);
    // Pinned to a 1px placeholder until the wrapper's first layout pass lands.
    expect(list._style.height).toBe('1px');
    expect(list._style.width).toBe('100%');
  });

  it('renders one <list-item> per item with item-key from keyExtractor', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    const cells = getAllByType(container, 'list-item');
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.props['item-key'])).toEqual(['a', 'b', 'c']);
    expect(cells[0].props['item-type']).toBe('item');
  });

  it('falls back to the array index when no keyExtractor is given', () => {
    const { container } = render(<List items={ITEMS} renderItem={renderRow} />);
    const cells = getAllByType(container, 'list-item');
    expect(cells.map((c) => c.props['item-key'])).toEqual(['0', '1', '2']);
  });

  it('renders horizontally and pins the width', () => {
    const { container } = render(
      <List items={ITEMS} horizontal keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    const list = getByType(container, 'list');
    expect(list.props['scroll-orientation']).toBe('horizontal');
    expect(list._style.width).toBe('1px');
    expect(list._style.height).toBe('100%');
  });

  it('maps numColumns/listType/itemSnap to native attributes', () => {
    const { container } = render(
      <List
        items={ITEMS}
        numColumns={2}
        listType="waterfall"
        itemSnap="center"
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
      />,
    );
    const list = getByType(container, 'list');
    expect(list.props['span-count']).toBe(2);
    expect(list.props['list-type']).toBe('waterfall');
    expect(list.props['item-snap']).toBe('center');
  });

  it('maps estimatedItemSize and itemType onto each cell', () => {
    const { container } = render(
      <List
        items={ITEMS}
        estimatedItemSize={48}
        itemType={(i) => (i.id === 'b' ? 'special' : 'normal')}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
      />,
    );
    const cells = getAllByType(container, 'list-item');
    expect(cells[0].props['estimated-main-axis-size-px']).toBe(48);
    expect(cells.map((c) => c.props['item-type'])).toEqual(['normal', 'special', 'normal']);
  });

  it('omits optional native attributes when their props are unset', () => {
    // An undefined prop would otherwise serialize to a native null write and
    // clobber the recycler defaults — so the keys must be absent entirely.
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    const list = getByType(container, 'list');
    expect('item-snap' in list.props).toBe(false);
    expect('lower-threshold-item-count' in list.props).toBe(false);
    expect('upper-threshold-item-count' in list.props).toBe(false);
    expect('scroll-event-throttle' in list.props).toBe(false);
    const cell = getAllByType(container, 'list-item')[0];
    expect('estimated-main-axis-size-px' in cell.props).toBe(false);
  });

  it('renders header and footer as full-span cells with reserved keys', () => {
    const { container } = render(
      <List
        items={ITEMS}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        slots={{
          header: () => <text>Header</text>,
          footer: () => <text>Footer</text>,
        }}
      />,
    );
    const cells = getAllByType(container, 'list-item');
    expect(cells).toHaveLength(5);
    expect(cells[0].props['full-span']).toBe(true);
    expect(cells[0].props['item-key']).toBe('__sigx_list_header__');
    expect(cells[cells.length - 1].props['item-key']).toBe('__sigx_list_footer__');
  });

  it('renders the empty slot in place of the list when there are no items', () => {
    const { container } = render(
      <List
        items={[] as typeof ITEMS}
        renderItem={renderRow}
        slots={{ empty: () => <text>Nothing here</text> }}
      />,
    );
    expect(() => getByType(container, 'list')).toThrow();
    const wrapper = container.children[0];
    expect(wrapper.children[0].type).toBe('text');
  });

  it('emits endReached / startReached on the native edge events', () => {
    const onEndReached = vi.fn();
    const onStartReached = vi.fn();
    const { container } = render(
      <List
        items={ITEMS}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        onEndReached={onEndReached}
        onStartReached={onStartReached}
      />,
    );
    const list = getByType(container, 'list');
    list._handlers.get('bindscrolltolower')?.({});
    list._handlers.get('bindscrolltoupper')?.({});
    expect(onEndReached).toHaveBeenCalledTimes(1);
    expect(onStartReached).toHaveBeenCalledTimes(1);
  });

  it('emits scroll with the main-axis offset', () => {
    const onScroll = vi.fn();
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} onScroll={onScroll} />,
    );
    const list = getByType(container, 'list');
    list._handlers.get('bindscroll')?.({ detail: { scrollTop: 120 } });
    expect(onScroll).toHaveBeenCalledWith({ offset: 120 });
  });

  it('de-dups onEndReached per edge-hit, re-arming after a scroll-up', () => {
    const onEndReached = vi.fn();
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} onEndReached={onEndReached} />,
    );
    const list = getByType(container, 'list');
    const lower = () => list._handlers.get('bindscrolltolower')?.({});
    const scrollTo = (top: number) => list._handlers.get('bindscroll')?.({ detail: { scrollTop: top } });

    lower();
    lower(); // still in-flight at the same edge → no second emit
    expect(onEndReached).toHaveBeenCalledTimes(1);

    scrollTo(500); // move down
    scrollTo(100); // scrolled back up → re-arm
    lower();
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

  it('renders a trailing loading cell when loadingMore is set', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} loadingMore />,
    );
    const cells = getAllByType(container, 'list-item');
    const last = cells[cells.length - 1];
    expect(last.props['item-key']).toBe('__sigx_list_loading__');
    expect(last.props['full-span']).toBe(true);
    expect(getByText(container, 'Loading…')).toBeTruthy();
  });

  it('opts into pull-to-refresh when the refreshing prop is passed', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} refreshing={false} />,
    );
    const list = getByType(container, 'list');
    // Scroll is enabled while not actively pulling, and the default indicator
    // is mounted (revealed by the pull, hidden otherwise).
    expect(list.props['enable-scroll']).toBe(true);
    expect(getByText(container, 'Refreshing…')).toBeTruthy();
  });

  it('renders a custom refresh indicator slot', () => {
    const { container } = render(
      <List
        items={ITEMS}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        refreshing={false}
        slots={{ refresh: () => <text>Custom pull</text> }}
      />,
    );
    expect(getByText(container, 'Custom pull')).toBeTruthy();
  });

  it('does not add scroll gating when pull-to-refresh is not opted into', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    const list = getByType(container, 'list');
    expect('enable-scroll' in list.props).toBe(false);
  });

  it('ignores pull-to-refresh on a horizontal list (vertical-only)', () => {
    // refreshing + horizontal must NOT gate enable-scroll, or a horizontal
    // list would have its scroll disabled off a misread vertical scrollTop.
    const { container } = render(
      <List
        items={ITEMS}
        horizontal
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        refreshing={false}
      />,
    );
    const list = getByType(container, 'list');
    expect('enable-scroll' in list.props).toBe(false);
  });

  // ── Chat / bottom-anchored mode ──────────────────────────────────────────

  it('chat mode: a vertical inverted list is opacity-gated until first scroll', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} inverted />,
    );
    const list = getByType(container, 'list');
    expect(list._style.opacity).toBe(0);
    // The scroll-to-bottom + reveal are driven by the native list's
    // `layoutcomplete` event (fires after native lays out the cells), not the
    // wrapper layout — invoking scrollToPosition before native has the cells
    // throws `position >= data count` on device.
    expect(list._handlers.has('bindlayoutcomplete')).toBe(true);
  });

  it('chat mode: lifts the opacity gate on the list layoutcomplete', async () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} inverted />,
    );
    expect(getByType(container, 'list')._style.opacity).toBe(0);
    // layoutcomplete = native has laid out the cells → scroll-to-bottom + reveal.
    await act(() => { getByType(container, 'list')._handlers.get('bindlayoutcomplete')!({}); });
    expect(getByType(container, 'list')._style.opacity).toBeUndefined();
  });

  it('chat mode is vertical-only: a horizontal inverted list is not gated', () => {
    const { container } = render(
      <List items={ITEMS} horizontal keyExtractor={(i) => i.id} renderItem={renderRow} inverted />,
    );
    const list = getByType(container, 'list');
    expect(list._style.opacity).toBeUndefined();
  });

  it('chat mode: no unread affordance initially (at bottom)', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} inverted />,
    );
    expect(queryByText(container, '1 new ↓')).toBeNull();
  });

  it('chat mode: shows the unread affordance when items arrive while scrolled up', async () => {
    const rows = signal<{ value: Row[] }>({ value: ITEMS });
    const Harness = component(() => () => (
      <List items={rows.value} keyExtractor={(i) => i.id} renderItem={renderRow} inverted />
    ));
    const { container } = render(<Harness />);
    // Complete the first paint so stick/unread tracking engages.
    await act(() => fireLayout(container));
    const list = getByType(container, 'list');
    // Scroll up → not at bottom.
    await act(() => {
      list._handlers.get('bindscroll')!({ detail: { scrollTop: 400 } });
      list._handlers.get('bindscroll')!({ detail: { scrollTop: 80 } });
    });
    // A new message arrives while scrolled up → unread affordance.
    await act(() => { rows.value = [...rows.value, { id: 'd', text: 'Delta' }]; });
    expect(getByText(container, '1 new ↓')).toBeTruthy();
  });

  it('chat mode: sticks to the bottom (no unread) when items arrive at the bottom', async () => {
    const rows = signal<{ value: Row[] }>({ value: ITEMS });
    const Harness = component(() => () => (
      <List items={rows.value} keyExtractor={(i) => i.id} renderItem={renderRow} inverted />
    ));
    const { container } = render(<Harness />);
    await act(() => fireLayout(container));
    // Still at the bottom → a new message must not raise the unread affordance.
    await act(() => { rows.value = [...rows.value, { id: 'd', text: 'Delta' }]; });
    expect(queryByText(container, '1 new ↓')).toBeNull();
  });

  it('chat mode: an empty inverted list is not opacity-gated (nothing to scroll to)', () => {
    const { container } = render(
      <List items={[] as Row[]} keyExtractor={(i) => i.id} renderItem={renderRow} inverted />,
    );
    const list = getByType(container, 'list');
    expect(list._style.opacity).toBeUndefined();
  });

  it('chat mode: surfaces unread even at the bottom when stickToBottom is off', async () => {
    const rows = signal<{ value: Row[] }>({ value: ITEMS });
    const Harness = component(() => () => (
      <List
        items={rows.value}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        inverted
        stickToBottom={false}
      />
    ));
    const { container } = render(<Harness />);
    await act(() => fireLayout(container));
    // At the bottom but not auto-following → a new message must surface the
    // affordance rather than silently incrementing an invisible counter.
    await act(() => { rows.value = [...rows.value, { id: 'd', text: 'Delta' }]; });
    expect(getByText(container, '1 new ↓')).toBeTruthy();
  });

  it('chat mode: load-older (prepend) does not raise the unread affordance', async () => {
    // The backend pattern: scroll up → fetch older → prepend at the front. Those
    // are NOT new messages, so the unread count must stay put (only an append at
    // the end counts). Detected via the last item's key, so use a real keyExtractor.
    const rows = signal<{ value: Row[] }>({ value: ITEMS });
    const Harness = component(() => () => (
      <List items={rows.value} keyExtractor={(i) => i.id} renderItem={renderRow} inverted />
    ));
    const { container } = render(<Harness />);
    await act(() => fireLayout(container));
    const list = getByType(container, 'list');
    // scroll up → not at bottom
    await act(() => {
      list._handlers.get('bindscroll')!({ detail: { scrollTop: 400 } });
      list._handlers.get('bindscroll')!({ detail: { scrollTop: 80 } });
    });
    // PREPEND two older messages (front grows, last item unchanged) → no unread.
    await act(() => {
      rows.value = [{ id: 'o1', text: 'older' }, { id: 'o2', text: 'older2' }, ...rows.value];
    });
    expect(queryByText(container, '2 new ↓')).toBeNull();
    // sanity: a real APPEND (new last item) still raises it.
    await act(() => { rows.value = [...rows.value, { id: 'z', text: 'new' }]; });
    expect(getByText(container, '1 new ↓')).toBeTruthy();
  });

  it('chat mode: a simultaneous prepend + append counts only the appended item', async () => {
    const rows = signal<{ value: Row[] }>({ value: ITEMS });
    const Harness = component(() => () => (
      <List items={rows.value} keyExtractor={(i) => i.id} renderItem={renderRow} inverted />
    ));
    const { container } = render(<Harness />);
    await act(() => fireLayout(container));
    const list = getByType(container, 'list');
    await act(() => {
      list._handlers.get('bindscroll')!({ detail: { scrollTop: 400 } });
      list._handlers.get('bindscroll')!({ detail: { scrollTop: 80 } });
    });
    // Two older prepended AND one new appended in the same update → unread = 1,
    // not 3 (prepended history must not be counted as new).
    await act(() => {
      rows.value = [
        { id: 'o1', text: 'older' }, { id: 'o2', text: 'older2' },
        ...rows.value,
        { id: 'z', text: 'new' },
      ];
    });
    expect(getByText(container, '1 new ↓')).toBeTruthy();
    expect(queryByText(container, '3 new ↓')).toBeNull();
  });

  // ── Windowing ────────────────────────────────────────────────────────────

  const big = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: String(i), text: `m${i}` }));

  it('windows on the very first render (no flush) — no full-list mount spike', () => {
    // Eager init: the window is resolved at setup, so the first frame already
    // renders only `windowSize` cells instead of materializing all 1000 and
    // waiting for the init effect's microtask. Asserted synchronously (no act).
    const { container } = render(
      <List items={big(1000)} keyExtractor={(i) => i.id} renderItem={renderRow} windowSize={60} />,
    );
    expect(getAllByType(container, 'list-item').length).toBe(60);
  });

  it('windowing renders only a bounded slice of a large feed', async () => {
    const { container } = render(
      <List items={big(1000)} keyExtractor={(i) => i.id} renderItem={renderRow} windowSize={60} />,
    );
    await act(() => {});
    const cells = getAllByType(container, 'list-item');
    expect(cells.length).toBe(60);
    // A feed anchors the window to the start.
    expect(cells[0].props['item-key']).toBe('0');
    expect(cells[59].props['item-key']).toBe('59');
  });

  it('without windowSize every item is rendered (no windowing)', () => {
    const { container } = render(
      <List items={big(200)} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    expect(getAllByType(container, 'list-item').length).toBe(200);
  });

  it('chat windowing anchors the initial window to the newest items', async () => {
    const { container } = render(
      <List items={big(1000)} keyExtractor={(i) => i.id} renderItem={renderRow} inverted windowSize={60} />,
    );
    await act(() => {});
    const cells = getAllByType(container, 'list-item');
    expect(cells.length).toBe(60);
    expect(cells[0].props['item-key']).toBe('940');
    expect(cells[59].props['item-key']).toBe('999');
  });

  // ── Dataset swaps (`itemsKey`) ───────────────────────────────────────────

  const bigB = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: `b${i}`, text: `b${i}` }));

  it('itemsKey swap re-anchors a windowed feed to the start', async () => {
    const data = signal<{ items: Row[]; key: string }>({ items: big(1000), key: 'A' });
    const Harness = component(() => () => (
      <List
        items={data.items}
        itemsKey={data.key}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        windowSize={60}
        pageSize={30}
      />
    ));
    const { container } = render(<Harness />);
    await act(() => {});
    // Scroll the window deeper into dataset A.
    const list = getByType(container, 'list');
    await act(() => { list._handlers.get('bindscrolltolower')!(); });
    expect(getAllByType(container, 'list-item').length).toBe(90);
    // Swap to dataset B → back to the initial window over the new items.
    await act(() => { data.$set({ items: bigB(500), key: 'B' }); });
    const cells = getAllByType(container, 'list-item');
    expect(cells.length).toBe(60);
    expect(cells[0].props['item-key']).toBe('b0');
    expect(cells[59].props['item-key']).toBe('b59');
  });

  it('swapping items WITHOUT changing itemsKey keeps clamp-only behavior', async () => {
    // Regression pin: the swap path must be driven by the key, not by the
    // items identity — appends/prepends/edits keep the old clamping semantics.
    const data = signal<{ items: Row[]; key: string }>({ items: big(1000), key: 'A' });
    const Harness = component(() => () => (
      <List
        items={data.items}
        itemsKey={data.key}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        windowSize={60}
        pageSize={30}
      />
    ));
    const { container } = render(<Harness />);
    await act(() => {});
    const list = getByType(container, 'list');
    await act(() => { list._handlers.get('bindscrolltolower')!(); });
    expect(getAllByType(container, 'list-item').length).toBe(90);
    // New array, same itemsKey → the window is only clamped, not re-anchored.
    await act(() => { data.$set({ items: bigB(100), key: 'A' }); });
    expect(getAllByType(container, 'list-item').length).toBe(90);
  });

  it('itemsKey swap resets scroll to the start', async () => {
    // In the test env runOnMainThread executes inline, so the scroll worklet's
    // invoke lands on a fake mtRef element synchronously.
    const fake = { current: { invoke: vi.fn() } };
    const data = signal<{ items: Row[]; key: string }>({ items: ITEMS, key: 'A' });
    const Harness = component(() => () => (
      <List
        items={data.items}
        itemsKey={data.key}
        mtRef={fake as never}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
      />
    ));
    render(<Harness />);
    await act(() => {});
    expect(fake.current.invoke).not.toHaveBeenCalled();
    await act(() => { data.$set({ items: bigB(3), key: 'B' }); });
    expect(fake.current.invoke).toHaveBeenCalledWith(
      'scrollToPosition',
      { position: 0, alignTo: 'top', offset: 0, smooth: false },
    );
    // And it's the key change that triggers it, not the items change.
    fake.current.invoke.mockClear();
    await act(() => { data.$set({ items: bigB(5), key: 'B' }); });
    expect(fake.current.invoke).not.toHaveBeenCalled();
  });

  it('itemsKey swap in chat mode anchors to the new newest and clears unread', async () => {
    const data = signal<{ items: Row[]; key: string }>({ items: big(1000), key: 'A' });
    const Harness = component(() => () => (
      <List
        items={data.items}
        itemsKey={data.key}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        inverted
        windowSize={60}
      />
    ));
    const { container } = render(<Harness />);
    await act(() => fireLayout(container));
    const list = getByType(container, 'list');
    // Scroll up, then append → the unread affordance shows.
    await act(() => {
      list._handlers.get('bindscroll')!({ detail: { scrollTop: 400 } });
      list._handlers.get('bindscroll')!({ detail: { scrollTop: 80 } });
    });
    await act(() => { data.$set({ items: [...data.items, { id: 'z', text: 'new' }], key: 'A' }); });
    expect(getByText(container, '1 new ↓')).toBeTruthy();
    // Swap datasets → window anchored to the new end, unread cleared.
    await act(() => { data.$set({ items: bigB(200), key: 'B' }); });
    const cells = getAllByType(container, 'list-item');
    expect(cells.length).toBe(60);
    expect(cells[0].props['item-key']).toBe('b140');
    expect(cells[59].props['item-key']).toBe('b199');
    expect(queryByText(container, '1 new ↓')).toBeNull();
  });

  it('scrolltoupper reveals an older page in a chat window', async () => {
    const { container } = render(
      <List
        items={big(1000)}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        inverted
        windowSize={60}
        pageSize={30}
      />,
    );
    await act(() => {});
    const list = getByType(container, 'list');
    expect(getAllByType(container, 'list-item').length).toBe(60);
    await act(() => { list._handlers.get('bindscrolltoupper')!(); });
    const cells = getAllByType(container, 'list-item');
    expect(cells.length).toBe(90); // 60 + one page of 30 older
    expect(cells[0].props['item-key']).toBe('910');
  });
});
