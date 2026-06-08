import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';
import { Toggle } from '../src/forms/Toggle';

describe('Toggle', () => {
  it('applies the checked class when statically checked', () => {
    const { container } = render(<Toggle checked />);
    expect(container.children[0]._class).toContain('toggle-checked');
  });

  it('omits the checked class when off', () => {
    const { container } = render(<Toggle checked={false} />);
    expect(container.children[0]._class).not.toContain('toggle-checked');
  });

  it('applies color and size classes', () => {
    const { container } = render(<Toggle checked color="accent" size="sm" />);
    const el = container.children[0];
    expect(el._class).toContain('toggle-accent');
    expect(el._class).toContain('toggle-sm');
  });

  it('applies disabled class', () => {
    const { container } = render(<Toggle disabled />);
    expect(container.children[0]._class).toContain('toggle-disabled');
  });

  it('reflects a bound model value (two-way binding)', () => {
    const on = signal(true);
    const { container } = render(<Toggle model={() => on.value} />);
    expect(container.children[0]._class).toContain('toggle-checked');
  });

  it('is off when the bound model is false', () => {
    const on = signal(false);
    const { container } = render(<Toggle model={() => on.value} />);
    expect(container.children[0]._class).not.toContain('toggle-checked');
  });
});
