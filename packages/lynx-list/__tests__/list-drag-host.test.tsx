/**
 * `<List>` ↔ `ScrollDragHost` adoption tests (#790) — the drag↔scroll
 * coordination contract a full-surface drag container (bottom sheet with
 * `dragMode="surface"`) provides and a vertical `<List>` adopts. Modeled on
 * lynx-gestures' `<ScrollView>`, the reference adopter; the MT worklet
 * bodies themselves run in the Lynx main-thread bundle, so these tests pin
 * the BG-observable surface: slot claims, ref binding, `enable-scroll`
 * gating, throttle, and release on unmount.
 */
import { describe, it, expect } from 'vitest';
import {
  component,
  signal,
  defineProvide,
  useScrollDragHost,
  useCreateScrollDragHost,
  type ScrollDragHost,
  type ViewFn,
} from '@sigx/lynx';
import { render, getByType, act } from '@sigx/lynx-testing';
import { List } from '../src/List';

interface Row { id: string; text: string }
const ITEMS: Row[] = [
  { id: 'a', text: 'Alpha' },
  { id: 'b', text: 'Beta' },
  { id: 'c', text: 'Gamma' },
];

const renderRow = (it: Row) => <text>{it.text}</text>;

/**
 * Wrap a List in a providing host. `preClaim` occupies the adopted-scrollable
 * slot before the List mounts (the "a ScrollView already adopted" case).
 * The created host is captured for assertions.
 */
function makeHarness(renderBody: () => unknown, opts?: { preClaim?: boolean }) {
  const captured: { host?: ScrollDragHost } = {};
  const Harness = component(() => {
    const host = useCreateScrollDragHost();
    captured.host = host;
    defineProvide(useScrollDragHost, () => host);
    if (opts?.preClaim) host.adoptVerticalScroll();
    // `<List>`'s generic JSX cast returns `unknown`, so harness bodies type
    // as `() => unknown` — re-assert the render-fn shape for `component()`.
    return renderBody as ViewFn;
  });
  return { Harness, captured };
}

describe('List ↔ ScrollDragHost adoption (#790)', () => {
  it('a vertical List claims the slot and binds the host-allocated ref', () => {
    const { Harness, captured } = makeHarness(() => (
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />
    ));
    const { container } = render(<Harness />);
    // The slot is taken — a later adopter is refused.
    expect(captured.host!.adoptVerticalScroll()).toBeNull();
    // One ref identity: the host's pre-allocated element ref IS the
    // `main-thread:ref`, so host worklets can drive the list directly.
    const list = getByType(container, 'list');
    expect(list.props['main-thread:ref']).toBe(captured.host!.scrollRef);
  });

  it('a horizontal List does not claim (vertical-only protocol)', () => {
    const { Harness, captured } = makeHarness(() => (
      <List items={ITEMS} horizontal keyExtractor={(i) => i.id} renderItem={renderRow} />
    ));
    const { container } = render(<Harness />);
    // Slot still free — the horizontal list never called adoptVerticalScroll.
    const release = captured.host!.adoptVerticalScroll();
    expect(typeof release).toBe('function');
    const list = getByType(container, 'list');
    expect(list.props['main-thread:ref']).not.toBe(captured.host!.scrollRef);
    // And no lock gating either — horizontal is orthogonal to a vertical drag.
    expect('enable-scroll' in list.props).toBe(false);
  });

  it('adopted: enable-scroll follows the host scrollLock', async () => {
    const { Harness, captured } = makeHarness(() => (
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />
    ));
    const { container } = render(<Harness />);
    expect(getByType(container, 'list').props['enable-scroll']).toBe(true);
    await act(() => { captured.host!.scrollLock.value = true; });
    expect(getByType(container, 'list').props['enable-scroll']).toBe(false);
    await act(() => { captured.host!.scrollLock.value = false; });
    expect(getByType(container, 'list').props['enable-scroll']).toBe(true);
  });

  it('non-adopted vertical List still gates on the lock but does not bind the host ref', async () => {
    // The slot was already claimed (e.g. an outer ScrollView won) — this List
    // must not bind host.scrollRef, but it still freezes during sheet drags.
    const { Harness, captured } = makeHarness(() => (
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />
    ), { preClaim: true });
    const { container } = render(<Harness />);
    const list = getByType(container, 'list');
    expect(list.props['main-thread:ref']).not.toBe(captured.host!.scrollRef);
    expect(list.props['enable-scroll']).toBe(true);
    await act(() => { captured.host!.scrollLock.value = true; });
    expect(getByType(container, 'list').props['enable-scroll']).toBe(false);
  });

  it('registers the MT scroll mirror when adopted (no refresh), and under refresh alone', () => {
    // Adopted, no pull-to-refresh: the mirror feeds the host's offset SV.
    const { Harness } = makeHarness(() => (
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />
    ));
    const adopted = render(<Harness />);
    expect(getByType(adopted.container, 'list')._handlers.has('main-thread-bindscroll')).toBe(true);
    // Refresh alone (no host): the mirror feeds the at-top gate, as before.
    const refresh = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} refreshing={false} />,
    );
    expect(getByType(refresh.container, 'list')._handlers.has('main-thread-bindscroll')).toBe(true);
    // Neither: no mirror registered at all.
    const plain = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    expect(getByType(plain.container, 'list')._handlers.has('main-thread-bindscroll')).toBe(false);
  });

  it('tightens scroll-event-throttle to 16ms only while adopted; consumer override wins', () => {
    const { Harness } = makeHarness(() => (
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />
    ));
    const adopted = render(<Harness />);
    expect(getByType(adopted.container, 'list').props['scroll-event-throttle']).toBe(16);

    // No host → the coarse #606 default stands.
    const plain = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    expect(getByType(plain.container, 'list').props['scroll-event-throttle']).toBe(100);

    // An explicit consumer value beats the adopted default.
    const { Harness: Overridden } = makeHarness(() => (
      <List
        items={ITEMS}
        scrollEventThrottle={50}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
      />
    ));
    const overridden = render(<Overridden />);
    expect(getByType(overridden.container, 'list').props['scroll-event-throttle']).toBe(50);
  });

  it('unmounting the adopted List releases the slot for re-adoption', async () => {
    const open = signal(true);
    const { Harness, captured } = makeHarness(() => (
      open.value
        ? <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />
        : <view />
    ));
    render(<Harness />);
    expect(captured.host!.adoptVerticalScroll()).toBeNull();
    await act(() => { open.value = false; });
    const release = captured.host!.adoptVerticalScroll();
    expect(typeof release).toBe('function');
  });

  it('refreshing + adopted compose: !pulling && !lock', async () => {
    const { Harness, captured } = makeHarness(() => (
      <List
        items={ITEMS}
        refreshing={false}
        keyExtractor={(i) => i.id}
        renderItem={renderRow}
      />
    ));
    const { container } = render(<Harness />);
    // Not pulling, not locked → scroll runs free.
    expect(getByType(container, 'list').props['enable-scroll']).toBe(true);
    // The host taking the drag locks the recycler even though no pull is active.
    await act(() => { captured.host!.scrollLock.value = true; });
    expect(getByType(container, 'list').props['enable-scroll']).toBe(false);
  });

  it('adopted: pins bounces off (iOS at-top reads stay truthful)', () => {
    const { Harness } = makeHarness(() => (
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />
    ));
    const adopted = render(<Harness />);
    expect(getByType(adopted.container, 'list').props['bounces']).toBe(false);
    // Non-adopted lists must not emit the attr at all (native default kept).
    const plain = render(
      <List items={ITEMS} keyExtractor={(i) => i.id} renderItem={renderRow} />,
    );
    expect('bounces' in getByType(plain.container, 'list').props).toBe(false);
  });
});
