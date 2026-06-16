import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';
import { Collapse } from '../src/layout/Collapse';

// Count nodes carrying an exact class token.
function countClass(node: any, token: string): number {
  let n = 0;
  if (typeof node?._class === 'string' && node._class.split(/\s+/).includes(token)) n++;
  for (const child of node?.children ?? []) n += countClass(child, token);
  return n;
}

// True if any text node in the subtree contains `str`.
function hasText(node: any, str: string): boolean {
  if (node == null) return false;
  if (typeof node === 'string') return node.includes(str);
  if (typeof node?._text === 'string' && node._text.includes(str)) return true;
  if (typeof node?.text === 'string' && node.text.includes(str)) return true;
  for (const child of node?.children ?? []) if (hasText(child, str)) return true;
  return false;
}

describe('Collapse', () => {
  it('renders the title and stays closed by default (no content)', () => {
    const { container } = render(
      <Collapse title="Section">{'Body'}</Collapse>,
    );
    expect(hasText(container, 'Section')).toBe(true);
    expect(countClass(container, 'collapse-content')).toBe(0);
    expect(countClass(container, 'collapse-open')).toBe(0);
  });

  it('renders content when defaultOpen', () => {
    const { container } = render(
      <Collapse title="Section" defaultOpen>{'Body'}</Collapse>,
    );
    expect(countClass(container, 'collapse-content')).toBe(1);
    expect(countClass(container, 'collapse-open')).toBe(1);
    expect(hasText(container, 'Body')).toBe(true);
  });

  it('reflects a bound model (two-way binding)', () => {
    const open = signal(true);
    const { container } = render(
      <Collapse title="S" model={() => open.value}>{'Body'}</Collapse>,
    );
    expect(countClass(container, 'collapse-open')).toBe(1);
  });

  it('is closed when the bound model is false', () => {
    const open = signal(false);
    const { container } = render(
      <Collapse title="S" model={() => open.value}>{'Body'}</Collapse>,
    );
    expect(countClass(container, 'collapse-open')).toBe(0);
    expect(countClass(container, 'collapse-content')).toBe(0);
  });

  it('applies the icon variant class', () => {
    const { container: arrow } = render(<Collapse title="S" />);
    expect(countClass(arrow, 'collapse-arrow')).toBe(1);
    const { container: plus } = render(<Collapse title="S" icon="plus" />);
    expect(countClass(plus, 'collapse-plus')).toBe(1);
    const { container: none } = render(<Collapse title="S" icon="none" />);
    expect(countClass(none, 'collapse-arrow')).toBe(0);
    expect(countClass(none, 'collapse-plus')).toBe(0);
  });

  it('accordion: only the item matching the group model is open', () => {
    const openItem = signal<string | undefined>('b');
    const { container } = render(
      <Collapse.Group model={() => openItem.value}>
        <Collapse value="a" title="A">{'A body'}</Collapse>
        <Collapse value="b" title="B">{'B body'}</Collapse>
        <Collapse value="c" title="C">{'C body'}</Collapse>
      </Collapse.Group>,
    );
    // Exactly one open, and it is the one whose content is "B body".
    expect(countClass(container, 'collapse-open')).toBe(1);
    expect(countClass(container, 'collapse-content')).toBe(1);
    expect(hasText(container, 'B body')).toBe(true);
    expect(hasText(container, 'A body')).toBe(false);
  });

  it('accordion: all closed when the group model matches nothing', () => {
    const openItem = signal<string | undefined>(undefined);
    const { container } = render(
      <Collapse.Group model={() => openItem.value}>
        <Collapse value="a" title="A">{'A body'}</Collapse>
        <Collapse value="b" title="B">{'B body'}</Collapse>
      </Collapse.Group>,
    );
    expect(countClass(container, 'collapse-open')).toBe(0);
  });
});
