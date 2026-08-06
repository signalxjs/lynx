/**
 * #844 — `bottomInset`: the frame-synced bottom content inset.
 *
 * BG-side wiring only (the native `setBottomInset` behavior is Android/iOS
 * code, and the binding's MT flush semantics are covered in
 * `lynx-runtime-main/__tests__/animated-method.test.ts`):
 *  - `custom-list-name="sigx-list"` opt-in rendered iff the prop is set
 *  - `main-thread:ref` bound for a plain (non-chat) list with an inset
 *  - the animated method binding targets `setBottomInset` with
 *    `valueKey: 'inset'`, `pin` iff chat mode's stick-to-bottom applies,
 *    and the consumer's SharedValue (or the internal mirror for numbers)
 */

import { describe, it, expect, vi } from 'vitest';

// Mutable so a test can render "as iOS" — `custom-list-name` is iOS-only now
// (#930); on Android the tag name selects the C++ list implementation, so
// naming one would downgrade the element to the legacy list.
const platform = vi.hoisted(() => ({ OS: 'android' as string }));

vi.mock('@sigx/lynx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@sigx/lynx')>();
  return { ...mod, useAnimatedMethod: vi.fn(mod.useAnimatedMethod), Platform: platform };
});

import { useAnimatedMethod, useSharedValue } from '@sigx/lynx';
import { render, getByType, getAllByType } from '@sigx/lynx-testing';
import { List } from '../src/List';
import type { AnimatedMethodSpec } from '@sigx/lynx';

interface Row { id: string; text: string }
const ITEMS: Row[] = [
  { id: 'a', text: 'Alpha' },
  { id: 'b', text: 'Beta' },
];
const renderRow = (it: Row) => <text>{it.text}</text>;

/** The accessor passed to the reactive `useAnimatedMethod` in the last render. */
function lastAccessor(): () => AnimatedMethodSpec | null {
  const mock = vi.mocked(useAnimatedMethod);
  expect(mock).toHaveBeenCalled();
  const args = mock.mock.calls[mock.mock.calls.length - 1]!;
  expect(typeof args[1]).toBe('function');
  return args[1] as () => AnimatedMethodSpec | null;
}

describe('List bottomInset (#844)', () => {
  it('renders custom-list-name="sigx-list" on iOS iff the prop is set', () => {
    platform.OS = 'ios';
    try {
      const { container } = render(
        <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} bottomInset={64} />,
      );
      expect(getByType(container, 'list').props['custom-list-name']).toBe('sigx-list');

      const { container: plain } = render(
        <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
      );
      expect(getByType(plain, 'list').props['custom-list-name']).toBeUndefined();
    } finally {
      platform.OS = 'android';
    }
  });

  it('never names a custom list tag off iOS (#930)', () => {
    // On Android the resolved tag name also selects the C++ list
    // implementation — only `list-container` reaches the modern one, so a
    // custom name silently downgrades the element to the legacy RecyclerView
    // list (whose instant bottom-aligned scroll lands short). Android gets
    // `setBottomInset` by registering `SigxListUI` as the app's
    // `list-container` instead; web has no native side at all.
    for (const os of ['android', 'web']) {
      platform.OS = os;
      const { container } = render(
        <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} bottomInset={64} />,
      );
      expect(getByType(container, 'list').props['custom-list-name']).toBeUndefined();
    }
    platform.OS = 'android';
  });

  it('binds main-thread:ref for a plain feed once an inset is set', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} bottomInset={64} />,
    );
    expect(getByType(container, 'list').props['main-thread:ref']).toBeTruthy();
  });

  it('targets setBottomInset with the consumer SharedValue, pin=true in chat mode', () => {
    const sv = useSharedValue(0);
    render(
      <List
        items={ITEMS}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        inverted
        bottomInset={sv}
      />,
    );
    const spec = lastAccessor()();
    expect(spec).not.toBeNull();
    expect(spec!.methodName).toBe('setBottomInset');
    expect(spec!.valueKey).toBe('inset');
    expect(spec!.params).toEqual({ pin: true });
    // The testing renderer clones prop values — compare the wire identity.
    expect(spec!.sv._wvid).toBe(sv._wvid);
  });

  it('pin=false without chat mode, and for stickToBottom={false}', () => {
    const sv = useSharedValue(0);
    render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} bottomInset={sv} />,
    );
    expect(lastAccessor()()!.params).toEqual({ pin: false });

    render(
      <List
        items={ITEMS}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
        inverted
        stickToBottom={false}
        bottomInset={sv}
      />,
    );
    expect(lastAccessor()()!.params).toEqual({ pin: false });
  });

  it('a numeric inset binds the internal mirror SV (not the consumer value)', () => {
    render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} bottomInset={48} />,
    );
    const spec = lastAccessor()();
    expect(spec).not.toBeNull();
    expect(spec!.sv).toBeTypeOf('object'); // internal useSharedValue(0) mirror
    expect(spec!.methodName).toBe('setBottomInset');
  });

  it('renders a trailing inset spacer cell off iOS, and none on iOS (#930)', () => {
    // The spacer is what actually clears the occluder on Android: the engine's
    // C++ scroller clamps against its own content size, so the inset has to BE
    // content. It must be the LAST cell — the bottom-aligned pin targets the
    // final cell, so the spacer parks against the viewport bottom and the
    // newest message lands exactly `inset` above it.
    platform.OS = 'android';
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} bottomInset={64} />,
    );
    const cells = getAllByType(container, 'list-item');
    const last = cells[cells.length - 1]!;
    expect(last.props['item-key']).toBe('__sigx_list_inset__');

    // iOS has a real viewport inset (contentInset) — a spacer there would
    // count the clearance twice.
    platform.OS = 'ios';
    const { container: ios } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} bottomInset={64} />,
    );
    expect(
      getAllByType(ios, 'list-item').some((c) => c.props['item-key'] === '__sigx_list_inset__'),
    ).toBe(false);
    platform.OS = 'android';
  });

  it('renders no spacer when the prop is absent', () => {
    const { container } = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    expect(
      getAllByType(container, 'list-item').some(
        (c) => c.props['item-key'] === '__sigx_list_inset__',
      ),
    ).toBe(false);
  });

  it('registers no method binding without the prop', () => {
    const mock = vi.mocked(useAnimatedMethod);
    const before = mock.mock.calls.length;
    render(<List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />);
    expect(mock.mock.calls.length).toBe(before);
  });
});
