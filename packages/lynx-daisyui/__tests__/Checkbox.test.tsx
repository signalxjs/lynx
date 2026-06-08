import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';
import { Checkbox } from '../src/forms/Checkbox';

describe('Checkbox', () => {
  it('renders the checkmark when statically checked', () => {
    const { container } = render(<Checkbox checked />);
    const el = container.children[0];
    expect(el._class).toContain('checkbox-checked');
    expect(el.children.length).toBeGreaterThan(0); // checkbox-mark
  });

  it('renders no checkmark when unchecked', () => {
    const { container } = render(<Checkbox checked={false} />);
    const el = container.children[0];
    expect(el._class).not.toContain('checkbox-checked');
    expect(el.children.length).toBe(0);
  });

  it('applies color and size classes', () => {
    const { container } = render(<Checkbox checked color="success" size="lg" />);
    const el = container.children[0];
    expect(el._class).toContain('checkbox-success');
    expect(el._class).toContain('checkbox-lg');
  });

  it('applies disabled class', () => {
    const { container } = render(<Checkbox disabled />);
    expect(container.children[0]._class).toContain('checkbox-disabled');
  });

  it('reflects a bound model value (two-way binding)', () => {
    const agreed = signal(true);
    const { container } = render(<Checkbox model={() => agreed.value} />);
    expect(container.children[0]._class).toContain('checkbox-checked');
  });

  it('is unchecked when the bound model is false', () => {
    const agreed = signal(false);
    const { container } = render(<Checkbox model={() => agreed.value} />);
    expect(container.children[0]._class).not.toContain('checkbox-checked');
  });
});
