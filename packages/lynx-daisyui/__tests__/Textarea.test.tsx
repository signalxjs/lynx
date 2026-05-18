import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Textarea } from '../src/forms/Textarea';

describe('Textarea', () => {
  it('renders with textarea class', () => {
    const { container } = render(<Textarea />);
    const textarea = container.children[0];
    expect(textarea._class).toContain('textarea');
  });

  it('applies bordered variant', () => {
    const { container } = render(<Textarea variant="bordered" />);
    const textarea = container.children[0];
    expect(textarea._class).toContain('textarea-bordered');
  });

  it('applies ghost variant', () => {
    const { container } = render(<Textarea variant="ghost" />);
    const textarea = container.children[0];
    expect(textarea._class).toContain('textarea-ghost');
  });

  it('applies color class', () => {
    const { container } = render(<Textarea color="primary" />);
    const textarea = container.children[0];
    expect(textarea._class).toContain('textarea-primary');
  });

  it('applies size class', () => {
    const { container } = render(<Textarea size="lg" />);
    const textarea = container.children[0];
    expect(textarea._class).toContain('textarea-lg');
  });

  it('applies placeholder', () => {
    const { container } = render(<Textarea placeholder="Enter text" />);
    const textarea = container.children[0];
    expect(textarea.props.placeholder).toBe('Enter text');
  });

  it('applies disabled', () => {
    const { container } = render(<Textarea disabled />);
    const textarea = container.children[0];
    expect(textarea.props.disabled).toBe(true);
  });

  it('calculates height from rows', () => {
    const { container } = render(<Textarea rows={5} />);
    const textarea = container.children[0];
    // 5 rows * 20 lineHeight + 16 padding = 116
    expect(textarea._style.height).toBe(116);
  });

  it('uses default 3 rows height', () => {
    const { container } = render(<Textarea />);
    const textarea = container.children[0];
    // 3 rows * 20 + 16 = 76
    expect(textarea._style.height).toBe(76);
  });

  it('applies custom class', () => {
    const { container } = render(<Textarea class="custom" />);
    const textarea = container.children[0];
    expect(textarea._class).toContain('custom');
  });
});
