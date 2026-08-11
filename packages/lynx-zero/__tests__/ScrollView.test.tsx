import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { ScrollView } from '../src/layout/ScrollView';

describe('ScrollView', () => {
  it('renders as scroll-view with vertical direction by default', () => {
    const { container } = render(
      <ScrollView>
        <view><text>Item</text></view>
      </ScrollView>
    );
    const sv = container.children[0];
    expect(sv.type).toBe('scroll-view');
    expect(sv.props['scroll-orientation']).toBe('vertical');
    expect(sv.props['scroll-y']).toBe(true);
  });

  it('renders horizontal direction', () => {
    const { container } = render(
      <ScrollView direction="horizontal">
        <view><text>Item</text></view>
      </ScrollView>
    );
    const sv = container.children[0];
    expect(sv.props['scroll-orientation']).toBe('horizontal');
    expect(sv.props['scroll-x']).toBe(true);
  });

  it('applies height and width styles', () => {
    const { container } = render(
      <ScrollView height={300} width={200}>
        <view><text>Item</text></view>
      </ScrollView>
    );
    const sv = container.children[0];
    expect(sv._style.height).toBe(300);
    expect(sv._style.width).toBe(200);
  });

  it('applies flex as long-form properties', () => {
    // Not the `flex: n` shorthand: Lynx expands it to `flex: n n auto`, and
    // `flexBasis: 'auto'` makes a scroll container size to its content instead
    // of taking the parent's leftover space — so the parent overflows and
    // nothing scrolls. Same reasoning as `resolveBoxStyle` and `.flex-fill`.
    const { container } = render(
      <ScrollView flex={1}>
        <view><text>Item</text></view>
      </ScrollView>
    );
    const sv = container.children[0];
    expect(sv._style.flex).toBeUndefined();
    expect(sv._style.flexGrow).toBe(1);
    expect(sv._style.flexShrink).toBe(1);
    expect(sv._style.flexBasis).toBe(0);
    expect(sv._style.minHeight).toBe(0);
  });

  it('passes showScrollbar and bounces attributes', () => {
    const { container } = render(
      <ScrollView showScrollbar={false} bounces={true}>
        <view><text>Item</text></view>
      </ScrollView>
    );
    const sv = container.children[0];
    expect(sv.props['show-scrollbar']).toBe(false);
    expect(sv.props['bounces']).toBe(true);
  });

  it('applies class', () => {
    const { container } = render(
      <ScrollView class="custom-scroll">
        <view><text>Item</text></view>
      </ScrollView>
    );
    const sv = container.children[0];
    expect(sv._class).toBe('custom-scroll');
  });
});
