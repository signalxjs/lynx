import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { FormField } from '../src/forms/FormField';

describe('FormField', () => {
  it('renders with form-control class', () => {
    const { container } = render(<FormField />);
    const field = container.children[0];
    expect(field._class).toContain('form-control');
  });

  it('renders label', () => {
    const { container } = render(<FormField label="Username" />);
    expect(container.findByText('Username')).toBeTruthy();
  });

  it('renders label with required indicator', () => {
    const { container } = render(<FormField label="Email" required />);
    expect(container.findByText('Email *')).toBeTruthy();
  });

  it('renders error message', () => {
    const { container } = render(<FormField error="This field is required" />);
    expect(container.findByText('This field is required')).toBeTruthy();
  });

  it('renders slot content', () => {
    const { container } = render(
      <FormField label="Name">
        <text>Child content</text>
      </FormField>
    );
    expect(container.findByText('Child content')).toBeTruthy();
  });

  it('applies custom class', () => {
    const { container } = render(<FormField class="custom" />);
    const field = container.children[0];
    expect(field._class).toContain('custom');
  });

  it('does not render label text when not provided', () => {
    const { container } = render(<FormField />);
    expect(container.findByText('label-text')).toBeNull();
  });
});
