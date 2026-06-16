import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';
import { Range } from '../src/forms/Range';

// First node in the subtree carrying an exact class token.
function find(node: any, token: string): any {
  if (typeof node?._class === 'string' && node._class.split(/\s+/).includes(token)) return node;
  for (const child of node?.children ?? []) {
    const hit = find(child, token);
    if (hit) return hit;
  }
  return null;
}

const fillWidth = (root: any) => find(root, 'range-fill')?._style?.width;
const thumbLeft = (root: any) => find(root, 'range-thumb')?._style?.left;

describe('Range', () => {
  it('renders the track, fill, and thumb', () => {
    const { container } = render(<Range value={0} />);
    expect(container.children[0]._class).toContain('range');
    expect(find(container, 'range-track')).toBeTruthy();
    expect(find(container, 'range-fill')).toBeTruthy();
    expect(find(container, 'range-thumb')).toBeTruthy();
  });

  it('maps the value to a fill/thumb percentage (default 0..100)', () => {
    const { container } = render(<Range value={50} />);
    expect(fillWidth(container)).toBe('50%');
    expect(thumbLeft(container)).toBe('50%');
  });

  it('reflects a bound model (two-way binding)', () => {
    const v = signal(25);
    const { container } = render(<Range model={() => v.value} />);
    expect(fillWidth(container)).toBe('25%');
  });

  it('clamps values outside [min, max]', () => {
    const { container: over } = render(<Range value={150} />);
    expect(fillWidth(over)).toBe('100%');
    const { container: under } = render(<Range value={-20} />);
    expect(fillWidth(under)).toBe('0%');
  });

  it('honours custom min/max', () => {
    const { container: a } = render(<Range value={5} min={0} max={10} />);
    expect(fillWidth(a)).toBe('50%');
    const { container: b } = render(<Range value={50} min={0} max={200} />);
    expect(fillWidth(b)).toBe('25%');
  });

  it('applies color and size classes', () => {
    const { container } = render(<Range value={10} color="success" size="lg" />);
    expect(container.children[0]._class).toContain('range-success');
    expect(container.children[0]._class).toContain('range-lg');
  });

  it('applies the disabled class', () => {
    const { container } = render(<Range value={10} disabled />);
    expect(container.children[0]._class).toContain('range-disabled');
  });
});
