import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Select } from '../src/components/Select';
import { FormField } from '../src/components/FormField';
import { Divider } from '../src/components/Divider';

const OPTS = [
  { label: 'One', value: '1' },
  { label: 'Two', value: '2' },
];

/** True if any node in the tree carries `cls` in its class list. */
function hasClass(node: any, cls: string): boolean {
  const c = node?._class ?? node?.props?.class;
  if (typeof c === 'string' && c.split(' ').includes(cls)) return true;
  for (const child of node?.children ?? []) {
    if (hasClass(child, cls)) return true;
  }
  return false;
}

describe('hero Select', () => {
  it('shows the placeholder when no value is selected', () => {
    const { container } = render(<Select options={OPTS} placeholder="Pick one" />);
    expect(container.findByText('Pick one')).toBeTruthy();
  });

  it('shows the selected option label', () => {
    const { container } = render(<Select options={OPTS} value="2" />);
    expect(container.findByText('Two')).toBeTruthy();
  });

  it('composes bordered variant, color and size on the trigger', () => {
    const { container } = render(<Select options={OPTS} variant="bordered" color="primary" size="lg" />);
    const trigger = container.children[0].children[0];
    const cls = trigger._class.split(' ');
    expect(cls).toContain('hero-select');
    expect(cls).toContain('hero-select-bordered');
    expect(cls).toContain('hero-select-primary');
    expect(cls).toContain('hero-select-lg');
  });

  it('is collapsed by default (no dropdown rendered)', () => {
    const { container } = render(<Select options={OPTS} />);
    expect(hasClass(container, 'hero-select-dropdown')).toBe(false);
  });
});

describe('hero FormField', () => {
  it('renders the label and appends the required marker', () => {
    const { container } = render(
      <FormField label="Email" required><view /></FormField>,
    );
    expect(container.findByText('Email *')).toBeTruthy();
  });

  it('renders the error line when set', () => {
    const { container } = render(
      <FormField label="Email" error="Required"><view /></FormField>,
    );
    expect(container.findByText('Required')).toBeTruthy();
  });

  it('omits label and error nodes when not provided', () => {
    const { container } = render(<FormField><view /></FormField>);
    expect(hasClass(container, 'hero-form-field-label')).toBe(false);
    expect(hasClass(container, 'hero-form-field-error')).toBe(false);
  });
});

describe('hero Divider', () => {
  it('renders a plain line with no label', () => {
    const { container } = render(<Divider />);
    expect(container.children[0]._class.split(' ')).toContain('hero-divider');
  });

  it('renders line · label · line when given content', () => {
    const { container } = render(<Divider><text>or</text></Divider>);
    const wrapper = container.children[0];
    // two flanking lines + the label node
    expect(wrapper.children.length).toBe(3);
    expect(wrapper.children[0]._class).toContain('hero-divider');
    expect(wrapper.children[2]._class).toContain('hero-divider');
  });

  it('uses the vertical line class when vertical', () => {
    const { container } = render(<Divider vertical />);
    expect(container.children[0]._class.split(' ')).toContain('hero-divider-vertical');
  });
});
