import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { themeController, colorsOf, toHexColor, withAlpha } from '@sigx/lynx-zero';
// Seed the daisy built-in themes (importing component modules directly
// bypasses the barrel that normally does this).
import '../src/theme/builtins';
import { Input } from '../src/forms/Input';
import { Textarea } from '../src/forms/Textarea';

describe('Input/Textarea — native-widget theme colors (#225)', () => {
  beforeEach(() => {
    themeController.set('daisy-light');
  });

  // Compare against the same normalization the components use, so the tests
  // stay correct if a theme ever ships rgb()/shorthand-hex palette entries.
  const expected = (theme: string) => toHexColor(colorsOf(theme)!['base-content']);

  it('Input carries the active theme base-content as a literal inline color', () => {
    const { container } = render(<Input placeholder="x" />);
    const el = container.children[0];
    expect(el._style.color).toBe(expected('daisy-light'));
    // placeholder = base-content at 45% alpha
    expect(el._style['-x-placeholder-color'])
      .toBe(withAlpha(expected('daisy-light'), 0.45));
  });

  it('Textarea carries the colors alongside its height style', () => {
    const { container } = render(<Textarea rows={2} />);
    const el = container.children[0];
    expect(el._style.height).toBe(2 * 20 + 16);
    expect(el._style.color).toBe(expected('daisy-light'));
    expect(el._style['-x-placeholder-color']).toBeDefined();
  });

  it('a different active theme resolves different literals', () => {
    themeController.set('daisy-dark');
    const { container } = render(<Input />);
    expect(container.children[0]._style.color).toBe(expected('daisy-dark'));
  });
});
