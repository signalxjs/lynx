/**
 * The host layout chain (#1064). A lynx `<view>` defaults to
 * `display: linear`, where every flex property on its CHILDREN is inert — so
 * a host that writes the flex-fill long form but forgets `display: flex`
 * silently breaks everything below it: a `<ScrollView flex={1}>` under
 * `ZeroRoot` sizes to its content and never scrolls.
 *
 * These are the regression guards for that. The legacy package carries the
 * same assertions (`lynx-zero-legacy/__tests__/theme-provider-host.test.tsx`);
 * the new stack dropped `display` on both branches when it was ported.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { OverlayHost, ThemeProvider, ZeroRoot, registerTheme, themeController } from '../src/index';

describe('ThemeProvider host layout', () => {
    beforeEach(() => {
        registerTheme({ name: 'hl-light', colorScheme: 'light' });
        registerTheme({ name: 'hl-alt', colorScheme: 'light' });
        themeController.set('hl-light');
    });

    it('root host is a flex column that fills its parent', () => {
        const { container } = render(
            <ThemeProvider initial="hl-light">
                <text>root</text>
            </ThemeProvider>,
        );
        const host = container.children[0];
        // Without these two, the flex-fill long form below is inert for
        // children — the whole point of #1064.
        expect(host._style.display).toBe('flex');
        expect(host._style.flexDirection).toBe('column');
        expect(host._style.flexGrow).toBe(1);
        expect(host._style.flexShrink).toBe(1);
        expect(host._style.flexBasis).toBe('0%');
        expect(host._style.minHeight).toBe(0);
    });

    it('nested host is a flex column that sizes to its content', () => {
        const { container } = render(
            <ThemeProvider initial="hl-light">
                <ThemeProvider initial="hl-alt">
                    <text>island</text>
                </ThemeProvider>
            </ThemeProvider>,
        );
        const nested = container.children[0].children[0];
        expect(nested._style.display).toBe('flex');
        expect(nested._style.flexDirection).toBe('column');
        // A sub-scope inside scroll content must NOT flex-fill: `flexBasis: 0`
        // on a scroll-view child computes to height 0.
        expect(nested._style.flexGrow).toBeUndefined();
        expect(nested._style.flexBasis).toBeUndefined();
    });

    it('consumer style still wins over the defaults', () => {
        const { container } = render(
            <ThemeProvider initial="hl-light" style={{ display: 'linear', flexGrow: 0 }}>
                <text>root</text>
            </ThemeProvider>,
        );
        const host = container.children[0];
        expect(host._style.display).toBe('linear');
        expect(host._style.flexGrow).toBe(0);
    });
});

describe('OverlayHost layout', () => {
    it('the outlet wrapper is a relative flex column that fills its parent', () => {
        const { container } = render(
            <OverlayHost>
                <text>content</text>
            </OverlayHost>,
        );
        const host = container.children[0];
        expect(host._style.position).toBe('relative');
        expect(host._style.display).toBe('flex');
        expect(host._style.flexDirection).toBe('column');
        expect(host._style.flexGrow).toBe(1);
        expect(host._style.minHeight).toBe(0);
    });
});

describe('ZeroRoot', () => {
    beforeEach(() => {
        registerTheme({ name: 'zr-light', colorScheme: 'light' });
        themeController.set('zr-light');
    });

    it('keeps the flex chain unbroken end to end — theme host, then outlet host', () => {
        const { container } = render(
            <ZeroRoot initial="zr-light">
                <text>app</text>
            </ZeroRoot>,
        );
        const themeHost = container.children[0];
        const outletHost = themeHost.children[0];
        for (const node of [themeHost, outletHost]) {
            expect(node._style.display).toBe('flex');
            expect(node._style.flexDirection).toBe('column');
            expect(node._style.flexGrow).toBe(1);
        }
    });
});
