import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Col } from '../src/layout/Col.js';

describe('Col', () => {
  it('renders children vertically', () => {
    const { container } = render(
      <Col>
        <text>A</text>
        <text>B</text>
      </Col>
    );
    const col = container.children[0];
    expect(col._style.flexDirection).toBe('column');
    expect(col._style.display).toBe('flex');
    expect(container.findByText('A')).toBeTruthy();
    expect(container.findByText('B')).toBeTruthy();
  });

  it('applies gap', () => {
    const { container } = render(<Col gap={12}><text>A</text></Col>);
    const col = container.children[0];
    expect(col._style.gap).toBe(12);
  });

  it('applies alignment', () => {
    const { container } = render(
      <Col align="center" justify="space-between">
        <text>A</text>
      </Col>
    );
    const col = container.children[0];
    expect(col._style.alignItems).toBe('center');
    expect(col._style.justifyContent).toBe('space-between');
  });

  it('applies padding', () => {
    const { container } = render(<Col padding={16}><text>A</text></Col>);
    const col = container.children[0];
    expect(col._style.paddingTop).toBe(16);
    expect(col._style.paddingRight).toBe(16);
    expect(col._style.paddingBottom).toBe(16);
    expect(col._style.paddingLeft).toBe(16);
  });

  it('applies wrap', () => {
    const { container } = render(<Col wrap><text>A</text></Col>);
    const col = container.children[0];
    expect(col._style.flexWrap).toBe('wrap');
  });

  it('applies class', () => {
    const { container } = render(<Col class="custom"><text>A</text></Col>);
    const col = container.children[0];
    expect(col._class).toBe('custom');
  });
});
