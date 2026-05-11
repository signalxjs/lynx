import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitForUpdate, touch } from '../src/index.js';
import { component, signal, jsx } from '@sigx/lynx';

describe('render', () => {
  it('renders a plain element tree', () => {
    const { container, getByType } = render(
      jsx('view', { children: [jsx('text', { children: 'Hello' })] }),
    );
    expect(container.children.length).toBe(1);
    const view = getByType('view');
    expect(view.type).toBe('view');
  });

  it('finds text content', () => {
    const { getByText } = render(
      jsx('view', { children: [jsx('text', { children: 'Hello World' })] }),
    );
    const node = getByText('Hello World');
    expect(node).toBeTruthy();
  });

  it('renders a component', () => {
    const Greeting = component(() => {
      return () => jsx('view', {
        children: [jsx('text', { children: 'Hi there' })],
      });
    });
    const { getByText } = render(jsx(Greeting, {}));
    expect(getByText('Hi there')).toBeTruthy();
  });

  it('handles props on elements', () => {
    const { getByType } = render(
      jsx('view', { id: 'root', class: 'container', children: [] }),
    );
    const view = getByType('view');
    expect(view.props.id).toBe('root');
    expect(view._class).toBe('container');
  });

  it('unmount cleans up', () => {
    const { container, unmount } = render(
      jsx('view', { children: [jsx('text', { children: 'Bye' })] }),
    );
    expect(container.children.length).toBe(1);
    unmount();
    expect(container.children.length).toBe(0);
  });
});

describe('fireEvent', () => {
  it('fires tap handler', () => {
    let tapped = false;
    const { getByType } = render(
      jsx('view', { bindtap: () => { tapped = true; }, children: [] }),
    );
    fireEvent.tap(getByType('view'));
    expect(tapped).toBe(true);
  });

  it('fires touch events', () => {
    const events: string[] = [];
    const { getByType } = render(
      jsx('view', {
        bindtouchstart: () => events.push('start'),
        bindtouchmove: () => events.push('move'),
        bindtouchend: () => events.push('end'),
        children: [],
      }),
    );
    const view = getByType('view');
    fireEvent.touchStart(view, { touches: [touch(100, 100)] });
    fireEvent.touchMove(view, { changedTouches: [touch(150, 150)] });
    fireEvent.touchEnd(view, { changedTouches: [touch(150, 150)] });
    expect(events).toEqual(['start', 'move', 'end']);
  });

  it('fires scroll event', () => {
    let scrollTop = 0;
    const { getByType } = render(
      jsx('scroll-view', {
        bindscroll: (e: any) => { scrollTop = e.detail.scrollTop; },
        children: [],
      }),
    );
    fireEvent.scroll(getByType('scroll-view'), { detail: { scrollTop: 200 } });
    expect(scrollTop).toBe(200);
  });
});

describe('reactive updates', () => {
  it('updates text when signal changes', async () => {
    const count = signal({ value: 0 });
    const Counter = component(() => {
      return () => jsx('text', { children: String(count.value) });
    });
    const { container } = render(jsx(Counter, {}));
    expect(container.findByText('0')).toBeTruthy();

    count.value = 5;
    await waitForUpdate();
    expect(container.findByText('5')).toBeTruthy();
  });
});
