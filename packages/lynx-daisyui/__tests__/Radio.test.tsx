import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Radio } from '../src/forms/Radio.js';

describe('Radio', () => {
  it('renders RadioGroup with items', () => {
    const { container } = render(
      <Radio>
        <Radio.Item value="a" label="Option A" />
        <Radio.Item value="b" label="Option B" />
      </Radio>
    );
    expect(container.findByText('Option A')).toBeTruthy();
    expect(container.findByText('Option B')).toBeTruthy();
  });

  it('applies color class to RadioItem', () => {
    const { container } = render(
      <Radio>
        <Radio.Item value="a" label="A" color="primary" />
      </Radio>
    );
    const group = container.children[0];
    const item = group.children[0];
    const radioCircle = item.children[0];
    expect(radioCircle._class).toContain('radio-primary');
  });

  it('applies size class to RadioItem', () => {
    const { container } = render(
      <Radio>
        <Radio.Item value="a" label="A" size="lg" />
      </Radio>
    );
    const group = container.children[0];
    const item = group.children[0];
    const radioCircle = item.children[0];
    expect(radioCircle._class).toContain('radio-lg');
  });

  it('renders radio-mark when checked', () => {
    const { container } = render(
      <Radio>
        <Radio.Item value="a" label="A" checked />
      </Radio>
    );
    const group = container.children[0];
    const item = group.children[0];
    const radioCircle = item.children[0];
    expect(radioCircle.children.length).toBeGreaterThan(0);
  });

  it('does not render radio-mark when unchecked', () => {
    const { container } = render(
      <Radio>
        <Radio.Item value="a" label="A" checked={false} />
      </Radio>
    );
    const group = container.children[0];
    const item = group.children[0];
    const radioCircle = item.children[0];
    expect(radioCircle.children.length).toBe(0);
  });

  it('applies disabled opacity', () => {
    const { container } = render(
      <Radio>
        <Radio.Item value="a" label="A" disabled />
      </Radio>
    );
    const group = container.children[0];
    const item = group.children[0];
    expect(item._style.opacity).toBe(0.5);
  });

  it('applies custom class to group', () => {
    const { container } = render(
      <Radio class="custom-group">
        <Radio.Item value="a" label="A" />
      </Radio>
    );
    const group = container.children[0];
    expect(group._class).toBe('custom-group');
  });
});
