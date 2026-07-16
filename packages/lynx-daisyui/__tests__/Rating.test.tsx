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

// Count nodes carrying an exact class token (whitespace-delimited).
function countClass(node: any, token: string): number {
  let n = 0;
  if (typeof node?._class === 'string' && node._class.split(/\s+/).includes(token)) n++;
  for (const child of node?.children ?? []) n += countClass(child, token);
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

  it('ignores fractional values without allowHalf (integer mode)', () => {
    const { container } = render(<Rating value={3.5} />);
    // 3 full active glyphs, no half overlay
    expect(countActive(container.children[0])).toBe(3);
    expect(countClass(container.children[0], 'rating-half')).toBe(0);
  });

  it('renders a half overlay at a .5 value when allowHalf is set', () => {
    const { container } = render(<Rating value={3.5} allowHalf />);
    // 3 full stars + 1 half overlay
    expect(countClass(container.children[0], 'rating-half')).toBe(1);
    // active glyphs: 3 full + the half overlay's filled glyph = 4
    expect(countActive(container.children[0])).toBe(4);
  });

  it('renders no half overlay at an integer value with allowHalf', () => {
    const { container } = render(<Rating value={3} allowHalf />);
    expect(countClass(container.children[0], 'rating-half')).toBe(0);
    expect(countActive(container.children[0])).toBe(3);
  });

  it('reflects a fractional bound model with allowHalf', () => {
    const stars = signal(2.5);
    const { container } = render(<Rating model={() => stars.value} allowHalf />);
    expect(countClass(container.children[0], 'rating-half')).toBe(1);
    expect(countActive(container.children[0])).toBe(3); // 2 full + 1 half overlay
  });
});
