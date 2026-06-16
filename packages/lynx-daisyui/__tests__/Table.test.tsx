import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Table, type TableColumn, type TableRow } from '../src/data/Table';

function countClass(node: any, token: string): number {
  let n = 0;
  if (typeof node?._class === 'string' && node._class.split(/\s+/).includes(token)) n++;
  for (const child of node?.children ?? []) n += countClass(child, token);
  return n;
}

function hasText(node: any, str: string): boolean {
  if (node == null) return false;
  if (typeof node === 'string') return node.includes(str);
  if (typeof node?._text === 'string' && node._text.includes(str)) return true;
  if (typeof node?.text === 'string' && node.text.includes(str)) return true;
  for (const child of node?.children ?? []) if (hasText(child, str)) return true;
  return false;
}

const cols: TableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'role', header: 'Role' },
];
const rows: TableRow[] = [
  { name: 'Ada', role: 'Pioneer' },
  { name: 'Alan', role: 'Theorist' },
  { name: 'Grace', role: 'Admiral' },
];

describe('Table', () => {
  it('renders a header cell per column', () => {
    const { container } = render(<Table columns={cols} rows={[]} />);
    expect(countClass(container, 'table-header')).toBe(1);
    expect(countClass(container, 'table-th')).toBe(2);
    expect(hasText(container, 'Name')).toBe(true);
    expect(hasText(container, 'Role')).toBe(true);
  });

  it('renders a row per data item with the cell values', () => {
    const { container } = render(<Table columns={cols} rows={rows} />);
    expect(countClass(container, 'table-row')).toBe(3);
    expect(countClass(container, 'table-td')).toBe(6); // 3 rows × 2 cols
    expect(hasText(container, 'Ada')).toBe(true);
    expect(hasText(container, 'Admiral')).toBe(true);
  });

  it('applies zebra striping to alternate rows', () => {
    const { container } = render(<Table columns={cols} rows={rows} zebra />);
    expect(container.children[0]._class).toContain('table-zebra');
    // rows at index 1 (only) among 3 get the alt class
    expect(countClass(container, 'table-row-alt')).toBe(1);
  });

  it('does not stripe when zebra is off', () => {
    const { container } = render(<Table columns={cols} rows={rows} />);
    expect(countClass(container, 'table-row-alt')).toBe(0);
  });

  it('applies the size class', () => {
    const { container } = render(<Table columns={cols} rows={rows} size="xs" />);
    expect(container.children[0]._class).toContain('table-xs');
  });

  it('renders empty cells for missing keys without throwing', () => {
    const { container } = render(
      <Table columns={cols} rows={[{ name: 'Solo' }] as TableRow[]} />,
    );
    expect(hasText(container, 'Solo')).toBe(true);
    expect(countClass(container, 'table-td')).toBe(2);
  });
});
