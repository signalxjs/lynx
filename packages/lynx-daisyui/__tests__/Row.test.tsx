import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Row } from '../src/layout/Row.js';

describe('Row', () => {
  it('renders children horizontally', () => {
    const { container } = render(
      <Row>
        <text>A</text>
        <text>B</text>
      </Row>
    );
    const row = container.children[0];
    expect(row._style.flexDirection).toBe('row');
    expect(row._style.display).toBe('flex');
    expect(container.findByText('A')).toBeTruthy();
    expect(container.findByText('B')).toBeTruthy();
  });

  it('applies gap', () => {
    const { container } = render(<Row gap={8}><text>A</text></Row>);
    const row = container.children[0];
    expect(row._style.gap).toBe(8);
  });

  it('applies alignment', () => {
    const { container } = render(
      <Row align="center" justify="space-between">
        <text>A</text>
      </Row>
    );
    const row = container.children[0];
    expect(row._style.alignItems).toBe('center');
    expect(row._style.justifyContent).toBe('space-between');
  });

  it('applies padding', () => {
    const { container } = render(<Row padding={16}><text>A</text></Row>);
    const row = container.children[0];
    expect(row._style.paddingTop).toBe(16);
    expect(row._style.paddingRight).toBe(16);
    expect(row._style.paddingBottom).toBe(16);
    expect(row._style.paddingLeft).toBe(16);
  });

  it('applies wrap', () => {
    const { container } = render(<Row wrap><text>A</text></Row>);
    const row = container.children[0];
    expect(row._style.flexWrap).toBe('wrap');
  });

  it('applies class', () => {
    const { container } = render(<Row class="custom"><text>A</text></Row>);
    const row = container.children[0];
    expect(row._class).toBe('custom');
  });
});
