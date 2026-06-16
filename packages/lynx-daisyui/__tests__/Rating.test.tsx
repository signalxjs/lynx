import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';
import { Rating } from '../src/forms/Rating';

// Count every node in the tree whose class marks a filled star. Interactive
// stars wrap the glyph in a <Pressable>, so the active class sits one level
// deeper than the row — a recursive walk handles both modes.
function countActive(node: any): number {
  let n = 0;
  if (typeof node?._class === 'string' && node._class.includes('rating-icon-active')) n++;
  for (const child of node?.children ?? []) n += countActive(child);
  return n;
}

// Count the rendered star glyphs (filled or empty).
function countIcons(node: any): number {
  let n = 0;
  if (typeof node?._class === 'string' && node._class.includes('rating-icon')) n++;
  for (const child of node?.children ?? []) n += countIcons(child);
  return n;
}

describe('Rating', () => {
  it('renders five icons by default', () => {
    const { container } = render(<Rating value={0} />);
    expect(countIcons(container.children[0])).toBe(5);
  });

  it('respects a custom max', () => {
    const { container } = render(<Rating value={0} max={10} />);
    expect(countIcons(container.children[0])).toBe(10);
  });

  it('fills icons up to the static value (unbound)', () => {
    const { container } = render(<Rating value={3} />);
    expect(countActive(container.children[0])).toBe(3);
  });

  it('reflects a bound model value (two-way binding)', () => {
    const stars = signal(4);
    const { container } = render(<Rating model={() => stars.value} />);
    expect(countActive(container.children[0])).toBe(4);
  });

  it('renders no filled icons when the bound model is zero', () => {
    const stars = signal(0);
    const { container } = render(<Rating model={() => stars.value} />);
    expect(countActive(container.children[0])).toBe(0);
  });

  it('applies color and size classes', () => {
    const { container } = render(<Rating value={2} color="success" size="lg" />);
    expect(container.children[0]._class).toContain('rating-success');
    expect(container.children[0]._class).toContain('rating-lg');
  });

  it('applies the read-only class', () => {
    const { container } = render(<Rating value={4} readOnly />);
    expect(container.children[0]._class).toContain('rating-readonly');
    expect(countActive(container.children[0])).toBe(4);
  });
});
