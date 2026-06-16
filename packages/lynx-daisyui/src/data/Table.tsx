import { component, type Define } from '@sigx/lynx';
import { ScrollView } from '@sigx/lynx-zero';

export type TableSize = 'xs' | 'sm' | 'md';
export type TableAlign = 'left' | 'center' | 'right';

export interface TableColumn {
  /** Key into each row object. */
  key: string;
  /** Header label. */
  header: string;
  /** Fixed column width in px; omitted columns flex to fill. Required for the
   *  columns to participate in horizontal scrolling (`scrollX`). */
  width?: number;
  /** Cell text alignment (default left). */
  align?: TableAlign;
}

export type TableRow = Record<string, string | number>;

export type TableProps =
  & Define.Prop<'columns', TableColumn[], true>
  & Define.Prop<'rows', TableRow[], true>
  & Define.Prop<'zebra', boolean, false>
  & Define.Prop<'size', TableSize, false>
  // Wrap the table in a horizontal scroll container for wide tables (Lynx has
  // no native table layout / `overflow-x`). Give columns explicit `width`s so
  // the total exceeds the viewport and can scroll.
  & Define.Prop<'scrollX', boolean, false>
  & Define.Prop<'class', string, false>;

const justifyFor = (align?: TableAlign) =>
  align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';

export const Table = component<TableProps>(({ props }) => {
  const cellStyle = (c: TableColumn) => {
    const st: Record<string, string | number> = { justifyContent: justifyFor(c.align) };
    if (c.width != null) {
      st.width = c.width;
      st.flexGrow = 0;
      st.flexShrink = 0;
    } else {
      st.flex = 1;
    }
    return st;
  };

  return () => {
    const cols = props.columns ?? [];
    const rows = props.rows ?? [];
    const size = props.size ?? 'md';
    const zebra = !!props.zebra;

    const c = ['table'];
    if (size !== 'md') c.push(`table-${size}`);
    if (zebra) c.push('table-zebra');
    if (props.class) c.push(props.class);
    const tableClass = c.join(' ');

    // For horizontal scrolling the row needs a fixed total width so it can
    // overflow the viewport; sum the explicit column widths.
    const totalWidth = cols.reduce((sum, col) => sum + (col.width ?? 0), 0);
    const tableStyle = props.scrollX && totalWidth > 0 ? { width: totalWidth } : undefined;

    const table = (
      <view class={tableClass} style={tableStyle}>
        <view class="table-header">
          {cols.map((col) => (
            <view class="table-cell table-th" style={cellStyle(col)}>
              <text class="table-th-text">{col.header}</text>
            </view>
          ))}
        </view>
        {rows.map((row, i) => (
          <view class={`table-row${zebra && i % 2 === 1 ? ' table-row-alt' : ''}`}>
            {cols.map((col) => (
              <view class="table-cell table-td" style={cellStyle(col)}>
                <text class="table-td-text">{String(row[col.key] ?? '')}</text>
              </view>
            ))}
          </view>
        ))}
      </view>
    );

    if (props.scrollX) {
      return (
        <ScrollView direction="horizontal" showScrollbar>
          {table}
        </ScrollView>
      );
    }
    return table;
  };
});
