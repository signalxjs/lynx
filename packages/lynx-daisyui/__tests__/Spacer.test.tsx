import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Spacer } from '../src/layout/Spacer.js';

describe('Spacer', () => {
  it('renders with flex:1 by default', () => {
    const { container } = render(<Spacer />);
    const spacer = container.children[0];
    expect(spacer._style.flex).toBe(1);
  });

  it('renders with fixed size', () => {
    const { container } = render(<Spacer size={16} />);
    const spacer = container.children[0];
    expect(spacer._style.width).toBe(16);
    expect(spacer._style.height).toBe(16);
    expect(spacer._style.flex).toBeUndefined();
  });

  it('applies class', () => {
    const { container } = render(<Spacer class="custom" />);
    const spacer = container.children[0];
    expect(spacer._class).toBe('custom');
  });
});
