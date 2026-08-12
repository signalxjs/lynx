import { describe, it, expect, vi } from 'vitest';
import { component, type Define } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { provideTabsSelection, useTabsSelection } from '../src/shared/tabs-selection';

// A minimal DS-shaped pair exercising the headless selection the way daisy
// and hero Tabs do.
type ContainerProps =
  & Define.Prop<'activeTab', string, false>
  & Define.Prop<'onChange', (value: string) => void, false>
  & Define.Slot<'default'>;

const Container = component<ContainerProps>(({ props, slots }) => {
  provideTabsSelection(
    () => props.activeTab,
    (v: string) => props.onChange?.(v),
  );
  return () => <view>{slots.default?.()}</view>;
});

type ItemProps = Define.Prop<'value', string, true>;

const Item = component<ItemProps>(({ props }) => {
  const selection = useTabsSelection();
  return () => (
    <view
      class={selection.isActive(props.value) ? 'active' : 'inactive'}
      bindtap={() => selection.select(props.value)}
    >
      <text>{props.value}</text>
    </view>
  );
});

function findByClass(node: any, cls: string): any {
  if (node._class === cls) return node;
  for (const child of node.children || []) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return null;
}

describe('headless tabs selection (#219 retro)', () => {
  it('derives active state from the container activeTab', () => {
    const { container } = render(
      <Container activeTab="b">
        <Item value="a" />
        <Item value="b" />
      </Container>,
    );
    const active = findByClass(container, 'active');
    expect(active).toBeTruthy();
    expect(active.textContent()).toBe('b');
  });

  it('select() reports through the container onChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Container activeTab="a" onChange={onChange}>
        <Item value="a" />
        <Item value="b" />
      </Container>,
    );
    const b = findByClass(container, 'inactive');
    b._handlers.get('bindtap')?.({});
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('is inert outside a container (never active, presses no-op)', () => {
    const { container } = render(<Item value="solo" />);
    expect(findByClass(container, 'inactive')).toBeTruthy();
    expect(() => findByClass(container, 'inactive')._handlers.get('bindtap')?.({})).not.toThrow();
  });
});
