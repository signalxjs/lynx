import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { themeController, colorsOf } from '@sigx/lynx-zero';
// Seed the daisy built-in themes (importing component modules directly
// bypasses the barrel that normally does this).
import '../src/theme/builtins';
import { Input } from '../src/forms/Input';
import { Textarea } from '../src/forms/Textarea';

describe('Input/Textarea — native-widget theme colors (#225)', () => {
  beforeEach(() => {
    themeController.set('daisy-light');
  });

  it('Input carries the active theme base-content as a literal inline color', () => {
    const { container } = render(<Input placeholder="x" />);
    const el = container.children[0];
    expect(el._style.color).toBe(colorsOf('daisy-light')!['base-content']);
    // placeholder = base-content at 45% alpha (hex byte 0x73)
    expect(el._style['-x-placeholder-color'])
      .toBe(`${colorsOf('daisy-light')!['base-content']}73`);
  });

  it('Textarea carries the colors alongside its height style', () => {
    const { container } = render(<Textarea rows={2} />);
    const el = container.children[0];
    expect(el._style.height).toBe(2 * 20 + 16);
    expect(el._style.color).toBe(colorsOf('daisy-light')!['base-content']);
    expect(el._style['-x-placeholder-color']).toBeDefined();
  });

  it('a different active theme resolves different literals', () => {
    themeController.set('daisy-dark');
    const { container } = render(<Input />);
    expect(container.children[0]._style.color)
      .toBe(colorsOf('daisy-dark')!['base-content']);
  });
});
