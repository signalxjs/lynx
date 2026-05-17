import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Center } from '../src/layout/Center.js';

describe('Center', () => {
  it('renders children centered', () => {
    const { container } = render(
      <Center>
        <text>Hello</text>
      </Center>
    );
    const center = container.children[0];
    expect(center._style.display).toBe('flex');
    expect(center._style.justifyContent).toBe('center');
    expect(center._style.alignItems).toBe('center');
    expect(container.findByText('Hello')).toBeTruthy();
  });

  it('applies width and height', () => {
    const { container } = render(
      <Center width={200} height={100}>
        <text>A</text>
      </Center>
    );
    const center = container.children[0];
    expect(center._style.width).toBe(200);
    expect(center._style.height).toBe(100);
  });

  it('applies flex as long-form so it fills inside flex-derived parents', () => {
    // `flex: n` shorthand expands to `flex: n 1 auto` in Lynx, where
    // `flexBasis: auto` sizes to content and collapses the chain. The
    // preset rewrites `flex={n}` into the long-form triple so consumers
    // actually get "fill remaining space".
    const { container } = render(
      <Center flex={1}>
        <text>A</text>
      </Center>
    );
    const center = container.children[0];
    expect(center._style.flexGrow).toBe(1);
    expect(center._style.flexShrink).toBe(1);
    expect(center._style.flexBasis).toBe(0);
  });

  it('applies background and borderRadius', () => {
    const { container } = render(
      <Center background="#ff0000" borderRadius={8}>
        <text>A</text>
      </Center>
    );
    const center = container.children[0];
    expect(center._style.backgroundColor).toBe('#ff0000');
    expect(center._style.borderRadius).toBe(8);
  });

  it('applies class', () => {
    const { container } = render(
      <Center class="custom">
        <text>A</text>
      </Center>
    );
    const center = container.children[0];
    expect(center._class).toBe('custom');
  });
});
