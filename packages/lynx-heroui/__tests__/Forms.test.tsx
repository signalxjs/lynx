import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';
import { Textarea } from '../src/components/Textarea';
import { Toggle } from '../src/components/Toggle';
import { Checkbox } from '../src/components/Checkbox';
import { Radio } from '../src/components/Radio';
import { Select } from '../src/components/Select';

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

  it('reflects a bound model value (two-way binding)', () => {
    const on = signal(true);
    const { container } = render(<Toggle model={() => on.value} />);
    expect(container.children[0]._class.split(' ')).toContain('hero-toggle-checked');
    expect(container.children[0].children[0]._style.transform).toBe('translateX(20px)');
  });

  it('rests off when the bound model is false', () => {
    const on = signal(false);
    const { container } = render(<Toggle model={() => on.value} />);
    expect(container.children[0]._class.split(' ')).not.toContain('hero-toggle-checked');
    expect(container.children[0].children[0]._style.transform).toBe('translateX(0px)');
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

  it('reflects a bound model value (two-way binding)', () => {
    const agreed = signal(true);
    const { container } = render(<Checkbox model={() => agreed.value} />);
    expect(container.children[0]._class.split(' ')).toContain('hero-checkbox-checked');
    expect(container.children[0].children.length).toBeGreaterThan(0);
  });

  it('is unchecked when the bound model is false', () => {
    const agreed = signal(false);
    const { container } = render(<Checkbox model={() => agreed.value} />);
    expect(container.children[0]._class.split(' ')).not.toContain('hero-checkbox-checked');
    expect(container.children[0].children.length).toBe(0);
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

  it('group value drives item selection; matching item is checked + inherits color', () => {
    const matches = render(
      <Radio value="b" color="success"><Radio.Item value="b" label="B" /></Radio>,
    ).container.children[0].children[0].children[0];
    expect(matches.children.length).toBeGreaterThan(0); // inner dot present
    expect(matches._class.split(' ')).toContain('hero-radio-success');
  });

  it('group value leaves a non-matching item unchecked', () => {
    const other = render(
      <Radio value="b" color="success"><Radio.Item value="a" label="A" /></Radio>,
    ).container.children[0].children[0].children[0];
    expect(other.children.length).toBe(0); // no inner dot
    expect(other._class.split(' ')).toContain('hero-radio-success'); // color still inherited
  });

  it('a bound group model drives item selection (two-way binding)', () => {
    const plan = signal('b');
    const matches = render(
      <Radio model={() => plan.value}><Radio.Item value="b" label="B" /></Radio>,
    ).container.children[0].children[0].children[0];
    expect(matches.children.length).toBeGreaterThan(0); // inner dot present

    const other = render(
      <Radio model={() => plan.value}><Radio.Item value="a" label="A" /></Radio>,
    ).container.children[0].children[0].children[0];
    expect(other.children.length).toBe(0); // no inner dot
  });
});

describe('hero Select', () => {
  const options = [
    { label: 'Apple', value: 'apple' },
    { label: 'Banana', value: 'banana' },
  ];

  it('shows the placeholder with no selection', () => {
    const { container } = render(<Select options={options} placeholder="Pick…" />);
    expect(container.findByText('Pick…')).toBeTruthy();
  });

  it('resolves the selected label from the static value (display-only)', () => {
    const { container } = render(<Select options={options} value="banana" />);
    expect(container.findByText('Banana')).toBeTruthy();
  });

  it('resolves the selected label from a bound model (two-way binding)', () => {
    const fruit = signal('apple');
    const { container } = render(<Select options={options} model={() => fruit.value} />);
    expect(container.findByText('Apple')).toBeTruthy();
  });
});
