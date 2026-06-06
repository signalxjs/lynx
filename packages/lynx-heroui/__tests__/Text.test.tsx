import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Text } from '../src/components/Text';

describe('hero Text', () => {
  it('defaults to the base size class', () => {
    const { container } = render(<Text>hello</Text>);
    expect(container.children[0]._class).toContain('hero-text-base');
  });

  it('applies size, weight and color classes', () => {
    const { container } = render(<Text size="2xl" weight="bold" color="primary">hi</Text>);
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-text-2xl');
    expect(cls).toContain('hero-font-bold');
    expect(cls).toContain('hero-text-primary');
  });

  it('maps selectable to text-selection and unflattens', () => {
    const { container } = render(<Text selectable>hi</Text>);
    const el = container.children[0];
    expect(el.props['text-selection']).toBe(true);
    expect(el.props['flatten']).toBe(false);
  });
});
