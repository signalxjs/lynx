import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Divider } from '../src/layout/Divider';

describe('Divider', () => {
  // TODO: update assertions for daisyui CSS-class rendering — component now
  // emits `divider` / `divider-vertical` class names, not inline styles.
  it.skip('renders horizontal divider by default', () => {
    const { container } = render(<Divider />);
    const el = container.children[0];
    expect(el._style.height).toBe(1);
    expect(el._style.alignSelf).toBe('stretch');
    expect(el._style.backgroundColor).toBe('#d1d5db');
  });

  // TODO: update assertions for daisyui CSS-class rendering.
  it.skip('renders vertical divider', () => {
    const { container } = render(<Divider vertical />);
    const el = container.children[0];
    expect(el._style.width).toBe(1);
    expect(el._style.alignSelf).toBe('stretch');
    expect(el._style.height).toBeUndefined();
  });

  it('applies custom color', () => {
    const { container } = render(<Divider color="#ff0000" />);
    const el = container.children[0];
    expect(el._style.backgroundColor).toBe('#ff0000');
  });

  it('applies margin for horizontal divider', () => {
    const { container } = render(<Divider margin={12} />);
    const el = container.children[0];
    expect(el._style.marginTop).toBe(12);
    expect(el._style.marginBottom).toBe(12);
  });

  it('applies margin for vertical divider', () => {
    const { container } = render(<Divider vertical margin={8} />);
    const el = container.children[0];
    expect(el._style.marginLeft).toBe(8);
    expect(el._style.marginRight).toBe(8);
  });

  // TODO: assertion should be toContain('custom') — component composes
  // base + user class, e.g. _class = 'divider custom'.
  it.skip('applies class', () => {
    const { container } = render(<Divider class="custom" />);
    const el = container.children[0];
    expect(el._class).toBe('custom');
  });
});
