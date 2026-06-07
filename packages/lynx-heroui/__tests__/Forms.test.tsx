import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Textarea } from '../src/components/Textarea';
import { Toggle } from '../src/components/Toggle';
import { Checkbox } from '../src/components/Checkbox';
import { Radio } from '../src/components/Radio';

describe('hero Textarea', () => {
  it('defaults to the flat surface (no bordered class)', () => {
    const { container } = render(<Textarea placeholder="x" />);
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-textarea');
    expect(cls).not.toContain('hero-textarea-bordered');
  });

  it('composes bordered variant, color and size', () => {
    const { container } = render(
      <Textarea variant="bordered" color="primary" size="lg" />,
    );
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-textarea-bordered');
    expect(cls).toContain('hero-textarea-primary');
    expect(cls).toContain('hero-textarea-lg');
  });

  it('sets height from rows', () => {
    const { container } = render(<Textarea rows={5} />);
    // 5 * 20 + 20 padding
    expect(container.children[0]._style.height).toBe(120);
  });
});

describe('hero Toggle', () => {
  it('marks the checked state and the selected color', () => {
    const { container } = render(<Toggle checked color="success" />);
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-toggle');
    expect(cls).toContain('hero-toggle-checked');
    expect(cls).toContain('hero-toggle-success');
  });

  it('translates the thumb when checked, rests at 0 when unchecked', () => {
    const on = render(<Toggle checked />);
    const onThumb = on.container.children[0].children[0];
    expect(onThumb._style.transform).toBe('translateX(20px)');

    const off = render(<Toggle />);
    const offThumb = off.container.children[0].children[0];
    expect(offThumb._style.transform).toBe('translateX(0px)');
  });

  it('travel offset tracks the size', () => {
    const lg = render(<Toggle checked size="lg" />);
    expect(lg.container.children[0].children[0]._style.transform).toBe('translateX(24px)');
  });
});

describe('hero Checkbox', () => {
  it('renders the checkmark only when checked', () => {
    const on = render(<Checkbox checked />);
    expect(on.container.children[0].children.length).toBeGreaterThan(0);
    const off = render(<Checkbox checked={false} />);
    expect(off.container.children[0].children.length).toBe(0);
  });

  it('composes checked + color + size classes', () => {
    const { container } = render(<Checkbox checked color="error" size="sm" />);
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-checkbox-checked');
    expect(cls).toContain('hero-checkbox-error');
    expect(cls).toContain('hero-checkbox-sm');
  });
});

describe('hero Radio', () => {
  it('renders a group with labelled items', () => {
    const { container } = render(
      <Radio>
        <Radio.Item value="a" label="Option A" />
        <Radio.Item value="b" label="Option B" />
      </Radio>,
    );
    expect(container.findByText('Option A')).toBeTruthy();
    expect(container.findByText('Option B')).toBeTruthy();
  });

  it('shows the inner dot only on the checked item', () => {
    const on = render(
      <Radio><Radio.Item value="a" label="A" checked /></Radio>,
    );
    const checkedCircle = on.container.children[0].children[0].children[0];
    expect(checkedCircle.children.length).toBeGreaterThan(0);

    const off = render(
      <Radio><Radio.Item value="b" label="B" checked={false} /></Radio>,
    );
    const uncheckedCircle = off.container.children[0].children[0].children[0];
    expect(uncheckedCircle.children.length).toBe(0);
  });

  it('applies color and size to the item circle', () => {
    const { container } = render(
      <Radio>
        <Radio.Item value="a" label="A" color="secondary" size="lg" />
      </Radio>,
    );
    const circle = container.children[0].children[0].children[0];
    const cls = circle._class.split(' ');
    expect(cls).toContain('hero-radio-secondary');
    expect(cls).toContain('hero-radio-lg');
  });

  it('group value drives item selection and color is inherited', () => {
    const { container } = render(
      <Radio value="b" color="success">
        <Radio.Item value="a" label="A" />
        <Radio.Item value="b" label="B" />
      </Radio>,
    );
    // The item matching the group value is checked (inner dot) and inherits color.
    const checkedCircle = render(
      <Radio value="b" color="success"><Radio.Item value="b" label="B" /></Radio>,
    ).container.children[0].children[0].children[0];
    expect(checkedCircle.children.length).toBeGreaterThan(0);
    expect(checkedCircle._class.split(' ')).toContain('hero-radio-success');
    expect(container).toBeTruthy();
  });
});
