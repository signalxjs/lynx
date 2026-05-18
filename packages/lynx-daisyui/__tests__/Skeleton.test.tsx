import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Skeleton } from '../src/feedback/Skeleton';

describe('Skeleton', () => {
  it('renders with skeleton class', () => {
    const { container } = render(<Skeleton />);
    expect(container.children[0]._class).toContain('skeleton');
  });

  it('applies width and height', () => {
    const { container } = render(<Skeleton width={200} height={20} />);
    const el = container.children[0];
    expect(el._style.width).toBe(200);
    expect(el._style.height).toBe(20);
  });

  it('renders circle shape', () => {
    const { container } = render(<Skeleton circle width={64} />);
    const el = container.children[0];
    expect(el._style.width).toBe(64);
    expect(el._style.height).toBe(64);
    expect(el._style.borderRadius).toBe(32);
  });

  it('uses default size for circle when no dimensions given', () => {
    const { container } = render(<Skeleton circle />);
    const el = container.children[0];
    expect(el._style.width).toBe(48);
    expect(el._style.height).toBe(48);
    expect(el._style.borderRadius).toBe(24);
  });

  it('applies custom class', () => {
    const { container } = render(<Skeleton class="custom-skel" />);
    expect(container.children[0]._class).toContain('custom-skel');
  });
});
