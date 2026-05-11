import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Avatar } from '../src/data/Avatar.js';

describe('Avatar', () => {
  it('renders with image src', () => {
    const { container } = render(<Avatar src="https://example.com/avatar.png" />);
    const avatar = container.children[0];
    expect(avatar._class).toContain('avatar');
    const inner = avatar.children[0];
    const img = inner.children[0];
    expect(img.props.src).toBe('https://example.com/avatar.png');
  });

  it('renders placeholder when no src', () => {
    const { container } = render(<Avatar placeholder="AB" />);
    const avatar = container.children[0];
    expect(avatar._class).toContain('placeholder');
    expect(container.findByText('AB')).toBeTruthy();
  });

  it('applies size correctly', () => {
    const { container } = render(<Avatar src="test.png" size="lg" />);
    const inner = container.children[0].children[0];
    expect(inner._style.width).toBe(64);
    expect(inner._style.height).toBe(64);
  });

  it('applies rounded full', () => {
    const { container } = render(<Avatar src="test.png" size="md" rounded="full" />);
    const inner = container.children[0].children[0];
    expect(inner._style.borderRadius).toBe(24);
  });

  it('applies online status', () => {
    const { container } = render(<Avatar src="test.png" online />);
    expect(container.children[0]._class).toContain('online');
  });

  it('applies offline status', () => {
    const { container } = render(<Avatar src="test.png" offline />);
    expect(container.children[0]._class).toContain('offline');
  });

  it('applies custom class', () => {
    const { container } = render(<Avatar src="test.png" class="custom" />);
    expect(container.children[0]._class).toContain('custom');
  });

  it('renders default placeholder when no src or placeholder text', () => {
    const { container } = render(<Avatar />);
    expect(container.findByText('?')).toBeTruthy();
  });
});
