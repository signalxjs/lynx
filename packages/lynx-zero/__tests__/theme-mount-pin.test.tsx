/**
 * A theme pinned while the root provider is still mounting (#1193).
 *
 * A cold deep link routes from `useLinkingNav`'s onMounted, which runs inside
 * the root provider's first render, and the routed screen pins its theme
 * there (`useScreenTheme` on focus). The reactive core drops a notification
 * to an effect that is still running, so the host kept the theme it mounted
 * with. The provider re-renders on mount when its state moved on.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { component, onMounted } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { ThemeProvider, registerTheme, themeController } from '../src/index';
import { clearTextRamp, registerTextRamp } from '../src/theme/text-ramp';

describe('ThemeProvider — a theme pinned during mount', () => {
    beforeEach(() => {
        registerTheme({ name: 'mp-light', colorScheme: 'light' });
        registerTheme({ name: 'mp-dark', colorScheme: 'dark' });
        themeController.set('mp-light');
    });

    it('a descendant pinning the theme in onMounted re-renders the host', () => {
        const Pin = component(() => {
            onMounted(() => themeController.set('mp-dark'));
            return () => <text>pin</text>;
        });
        const { container } = render(
            <ThemeProvider initial="mp-light">
                <Pin />
            </ThemeProvider>,
        );
        expect(themeController.name).toBe('mp-dark');
        expect(container.children[0]._class).toContain('mp-dark');
        expect(container.children[0]._class).not.toContain('mp-light');
    });

    it('a descendant pinning the theme in setup re-renders the host', () => {
        const Pin = component(() => {
            themeController.set('mp-dark');
            return () => <text>pin</text>;
        });
        const { container } = render(
            <ThemeProvider initial="mp-light">
                <Pin />
            </ThemeProvider>,
        );
        expect(container.children[0]._class).toContain('mp-dark');
    });

    it('a font scale set during mount reaches the host too', () => {
        registerTextRamp({ base: '16px' });
        const Pin = component(() => {
            onMounted(() => themeController.setFontScale(2));
            return () => <text>pin</text>;
        });
        const { container } = render(
            <ThemeProvider initial="mp-light">
                <Pin />
            </ThemeProvider>,
        );
        expect(container.children[0]._style['--text-base']).toBe('32px');
        themeController.setFontScale(1);
        clearTextRamp();
    });
});
