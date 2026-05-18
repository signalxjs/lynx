import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Select } from '../src/forms/Select';

const options = [
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Cherry', value: 'cherry' },
];

describe('Select', () => {
  it('renders with placeholder', () => {
    const { container } = render(
      <Select options={options} placeholder="Pick a fruit" />
    );
    const select = container.children[0];
    expect(container.findByText('Pick a fruit')).toBeTruthy();
  });

  it('renders selected value label', () => {
    const { container } = render(
      <Select options={options} value="banana" />
    );
    expect(container.findByText('Banana')).toBeTruthy();
  });

  it('applies variant class', () => {
    const { container } = render(
      <Select options={options} variant="bordered" />
    );
    const select = container.children[0];
    const trigger = select.children[0];
    expect(trigger._class).toContain('select-bordered');
  });

  it('applies color class', () => {
    const { container } = render(
      <Select options={options} color="primary" />
    );
    const select = container.children[0];
    const trigger = select.children[0];
    expect(trigger._class).toContain('select-primary');
  });

  it('applies size class', () => {
    const { container } = render(
      <Select options={options} size="lg" />
    );
    const select = container.children[0];
    const trigger = select.children[0];
    expect(trigger._class).toContain('select-lg');
  });

  it('applies disabled opacity', () => {
    const { container } = render(
      <Select options={options} disabled />
    );
    const select = container.children[0];
    expect(select._style.opacity).toBe(0.5);
  });

  it('applies custom class', () => {
    const { container } = render(
      <Select options={options} class="custom" />
    );
    const select = container.children[0];
    const trigger = select.children[0];
    expect(trigger._class).toContain('custom');
  });
});
