import { describe, it, expect, beforeEach } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { registerTheme, themeController } from '@sigx/lynx-zero';
import { useMarkdownEditorTheme } from '../src/markdown/editorTheme';

const CORE = {
  'primary': '#0000ff', 'primary-content': '#ffffff',
  'secondary': '#ff00ff', 'secondary-content': '#ffffff',
  'accent': '#00ffff', 'accent-content': '#000000',
  'neutral': '#444444', 'neutral-content': '#ffffff',
  'base-100': '#18181b', 'base-200': '#27272a', 'base-300': '#3f3f46',
  'base-content': 'rgb(229, 231, 235)',
  'info': '#0088ff', 'info-content': '#000000',
  'success': '#00cc66', 'success-content': '#000000',
  'warning': '#ffaa00', 'warning-content': '#000000',
  'error': '#ff0000', 'error-content': '#ffffff',
} as const;

const Probe = component(() => {
  const theme = useMarkdownEditorTheme();
  return () => {
    const popup = theme.suggestionPopup;
    return (
      <view
        style={{
          // Stash the resolved popup colors on a probe element so the test
          // can read them back from the rendered style.
          backgroundColor: popup.surfaceColor!,
          borderColor: popup.borderColor!,
          '-x-active': popup.activeColor!,
          color: popup.textColor!,
        }}
      />
    );
  };
});

describe('useMarkdownEditorTheme().suggestionPopup', () => {
  beforeEach(() => {
    registerTheme({ name: 'editor-dark', variant: 'dark', colors: { ...CORE } });
    themeController.set('editor-dark');
  });

  it('resolves popup colors from the active theme palette', () => {
    const { container } = render(<Probe />);
    const style = container.children[0]._style;
    expect(style.backgroundColor).toBe('#18181b'); // base-100
    expect(style.borderColor).toBe('#3f3f46'); // base-300
    expect(style.color).toBe('#e5e7eb'); // base-content (rgb normalized)
    // base-content at 10% alpha → 0.1 * 255 ≈ 26 → 0x1a
    expect(style['-x-active']).toBe('#e5e7eb1a');
  });
});
