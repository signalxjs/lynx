import { describe, it, expect, vi } from 'vitest';
import { render, getByType, getAllByType } from '@sigx/lynx-testing';
import { List } from '../src/List';

const ITEMS = [
  { id: 'a', text: 'Alpha' },
  { id: 'b', text: 'Beta' },
  { id: 'c', text: 'Gamma' },
];

const renderRow = (it: { id: string; text: string }) => <text>{it.text}</text>;

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
});
