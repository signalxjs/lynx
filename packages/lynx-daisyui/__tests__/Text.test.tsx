import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Text } from '../src/typography/Text';

describe('Text', () => {
  it('defaults to the text-base size class', () => {
    const { container } = render(<Text>hello</Text>);
    expect(container.children[0]._class).toContain('text-base');
  });

  it('applies size, weight and color classes', () => {
    const { container } = render(<Text size="2xl" weight="bold" color="primary">hi</Text>);
    const el = container.children[0];
    expect(el._class).toContain('text-2xl');
    expect(el._class).toContain('font-bold');
    expect(el._class).toContain('text-primary');
    expect(el._class).not.toContain('text-base');
  });

  it('suppresses the size default when class carries a text-* size', () => {
    const { container } = render(<Text class="text-sm">hi</Text>);
    expect(container.children[0]._class).not.toContain('text-base');
    expect(container.children[0]._class).toContain('text-sm');
  });

  it('keeps the size default for color tokens like text-base-content', () => {
    const { container } = render(<Text class="text-base-content">hi</Text>);
    expect(container.children[0]._class).toContain('text-base ');
  });

  describe('selection', () => {
    it('maps selectable to text-selection and unflattens', () => {
      const { container } = render(<Text selectable>hi</Text>);
      const el = container.children[0];
      expect(el.props['text-selection']).toBe(true);
      expect(el.props['flatten']).toBe(false);
    });

    it('does not unflatten when not selectable', () => {
      const { container } = render(<Text>hi</Text>);
      expect('flatten' in container.children[0].props).toBe(false);
    });

    it('maps customSelection to custom-text-selection', () => {
      const { container } = render(<Text selectable customSelection>hi</Text>);
      expect(container.children[0].props['custom-text-selection']).toBe(true);
    });
  });

  describe('autoSize', () => {
    it('emits no auto-font-size styles by default', () => {
      const { container } = render(<Text>hi</Text>);
      expect(container.children[0]._style).toEqual({});
    });

    it('autoSize enables -x-auto-font-size with native defaults', () => {
      const { container } = render(<Text autoSize>hi</Text>);
      expect(container.children[0]._style['-x-auto-font-size']).toBe('true');
    });

    it('autoSize={false} emits no styles', () => {
      const { container } = render(<Text autoSize={false}>hi</Text>);
      expect(container.children[0]._style).toEqual({});
    });

    it('min/max/step are emitted positionally', () => {
      const { container } = render(
        <Text autoSize={{ min: '14px', max: '24px', step: '2px' }}>hi</Text>,
      );
      expect(container.children[0]._style['-x-auto-font-size']).toBe('true 14px 24px 2px');
    });

    it('max is dropped without min, step without max (positional CSS)', () => {
      const { container: noMin } = render(<Text autoSize={{ max: '24px' }}>hi</Text>);
      expect(noMin.children[0]._style['-x-auto-font-size']).toBe('true');
      const { container: noMax } = render(<Text autoSize={{ min: '14px', step: '2px' }}>hi</Text>);
      expect(noMax.children[0]._style['-x-auto-font-size']).toBe('true 14px');
    });

    it('presets map to -x-auto-font-size-preset-sizes', () => {
      const { container } = render(
        <Text autoSize={{ presets: ['12px', '15px', '17px'] }}>hi</Text>,
      );
      const style = container.children[0]._style;
      expect(style['-x-auto-font-size']).toBe('true');
      expect(style['-x-auto-font-size-preset-sizes']).toBe('12px 15px 17px');
    });

    it('lineRanges map to line-range() functions incl. "to infinity"', () => {
      const { container } = render(
        <Text
          autoSize={{
            lineRanges: [
              { lines: 1, min: '18px', max: '22px' },
              { lines: [2, 'infinity'], min: '14px' },
            ],
          }}
        >
          hi
        </Text>,
      );
      expect(container.children[0]._style['-x-auto-font-size-line-ranges']).toBe(
        'line-range(1, 18px, 22px), line-range(2 to infinity, 14px)',
      );
    });
  });
});
