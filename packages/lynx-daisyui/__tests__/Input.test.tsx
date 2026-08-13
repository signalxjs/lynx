import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { themeController, colorsOf, toHexColor, withAlpha, type ColorToken } from '@sigx/lynx-zero-legacy';
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
  const token = (theme: string, name: ColorToken) => toHexColor(colorsOf(theme)![name]);

  it('Input carries the active theme base-content as a literal inline color', () => {
    const { container } = render(<Input placeholder="x" />);
    // #993: children[0] is the box wrapper <view>; the native input inside
    // carries the text colors.
    const el = container.children[0].children[0];
    expect(el._style.color).toBe(expected('daisy-light'));
    // placeholder = base-content at 45% alpha
    expect(el._style['-x-placeholder-color'])
      .toBe(withAlpha(expected('daisy-light'), 0.45));
  });

  it('a post-mount theme switch recolors the wrapper without remounting the field (#993)', () => {
    const { container } = render(<Input variant="bordered" />);
    const box = container.children[0];
    const field = box.children[0];
    themeController.set('daisy-dark');
    // Same elements — updated in place, never recreated (a remount would
    // clear the native field's text through the model binding).
    expect(container.children[0]).toBe(box);
    expect(container.children[0].children[0]).toBe(field);
    // The box repaints with the new palette — the #993 contract: these
    // colors must live on the wrapper view because iOS ignores post-mount
    // style updates on the input element itself.
    expect(box._style.backgroundColor).toBe(token('daisy-dark', 'base-100'));
    expect(box._style.borderColor).toBe(token('daisy-dark', 'base-300'));
  });

  it('Input paints the box on the wrapper and keeps the native field transparent (#993)', () => {
    const { container } = render(<Input variant="bordered" />);
    const box = container.children[0];
    const field = box.children[0];
    // iOS ignores post-mount inline style updates on the input element, so
    // the theme-reactive background/border must live on the wrapper view.
    expect(box._style.backgroundColor).toBe(token('daisy-light', 'base-100'));
    expect(box._style.borderColor).toBe(token('daisy-light', 'base-300'));
    expect(field._style.backgroundColor).toBe('transparent');
    expect(field._style.borderWidth).toBe('0px');
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
    expect(container.children[0].children[0]._style.color).toBe(expected('daisy-dark'));
  });

  it('Input fills its background with the active theme base-100 literal', () => {
    const { container } = render(<Input />);
    expect(container.children[0]._style.backgroundColor).toBe(token('daisy-light', 'base-100'));
  });

  it('Input ghost variant keeps a transparent background', () => {
    const { container } = render(<Input variant="ghost" />);
    expect(container.children[0]._style.backgroundColor).toBe('transparent');
  });

  it('Input bordered variant resolves base-300 as the literal border color', () => {
    const { container } = render(<Input variant="bordered" />);
    expect(container.children[0]._style.borderColor).toBe(token('daisy-light', 'base-300'));
  });

  it('Input color prop wins over the bordered default for border color', () => {
    const { container } = render(<Input variant="bordered" color="primary" />);
    expect(container.children[0]._style.borderColor).toBe(token('daisy-light', 'primary'));
  });

  it('Input without a variant carries no inline border color', () => {
    const { container } = render(<Input />);
    expect(container.children[0]._style.borderColor).toBeUndefined();
  });

  it('Textarea fills its background and resolves bordered border colors too', () => {
    const { container } = render(<Textarea variant="bordered" />);
    const el = container.children[0];
    expect(el._style.backgroundColor).toBe(token('daisy-light', 'base-100'));
    expect(el._style.borderColor).toBe(token('daisy-light', 'base-300'));
  });

  it('Textarea ghost variant keeps a transparent background', () => {
    const { container } = render(<Textarea variant="ghost" />);
    expect(container.children[0]._style.backgroundColor).toBe('transparent');
  });

  it('the background literal tracks the active theme', () => {
    themeController.set('daisy-dark');
    const { container } = render(<Input />);
    expect(container.children[0]._style.backgroundColor).toBe(token('daisy-dark', 'base-100'));
  });
});
