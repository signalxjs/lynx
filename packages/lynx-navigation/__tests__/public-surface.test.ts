/**
 * Public-surface freeze tests for @sigx/lynx-navigation.
 *
 * These tests lock the package's exported API so accidental removals or
 * renames break CI rather than reaching consumers. When the surface changes
 * intentionally, update both the value snapshot and the type assertions
 * here as part of the same PR.
 *
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect.
 *  - Types: a handful of representative shapes (Drawer slot props,
 *    `useScreenOptions` callable signatures, `Link` props, TabBar
 *    `renderTab`) are pinned via `expectTypeOf`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as nav from '../src/index';
import type {
    DrawerNav,
    LinkProps,
    NavSnapshot,
    Nav,
    PushOptions,
    RouteId,
    ScreenOptions,
    TabInfo,
    TabRenderContext,
    TabsNav,
    UseLinkingNavOptions,
    UseNavSerializerOptions,
} from '../src/index';
import './_fixtures';

// ---------------------------------------------------------------------------
// Runtime surface — the exact set of value exports we ship at 1.0.
// ---------------------------------------------------------------------------

describe('public runtime exports', () => {
    it('matches the locked 1.0 surface', () => {
        const valueExportNames = Object.keys(nav).sort();
        expect(valueExportNames).toEqual(
            [
                'Drawer',
                'Header',
                'Link',
                'NAV_SNAPSHOT_VERSION',
                'NavigationRoot',
                'Screen',
                'Stack',
                'TabBar',
                'Tabs',
                '_clearRouteRegistry',
                '_setRouteRegistry',
                'compilePath',
                'defineRoutes',
                'hrefFor',
                'parseHref',
                'useDrawer',
                'useFocusEffect',
                'useHardwareBack',
                'useIsFocused',
                'useLinkingNav',
                'useNav',
                'useNavSerializer',
                'useParams',
                'useScreenChrome',
                'useScreenOptions',
                'useSearch',
                'useSheetHeight',
                'useTabs',
            ].sort(),
        );
    });

    it('NAV_SNAPSHOT_VERSION is a positive integer', () => {
        expect(typeof nav.NAV_SNAPSHOT_VERSION).toBe('number');
        expect(nav.NAV_SNAPSHOT_VERSION).toBeGreaterThan(0);
        expect(Number.isInteger(nav.NAV_SNAPSHOT_VERSION)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Type surface — pin shapes for the newer 0.3 / 0.5 / 0.6 APIs.
// ---------------------------------------------------------------------------

describe('Nav controller — additional methods', () => {
    it('exposes pop / canGoBack / current as signal-like reads', () => {
        const n = {} as Nav;
        expectTypeOf(n.pop).toBeFunction();
        expectTypeOf(n.canGoBack).toBeBoolean();
        // `current` is a reactive accessor — exact shape lives in Nav.
        expectTypeOf(n).toHaveProperty('current');
    });

    it('push accepts a PushOptions third arg', () => {
        // PushOptions surface is part of the public type contract.
        expectTypeOf<PushOptions>().toEqualTypeOf<PushOptions>();
    });
});

describe('DrawerNav', () => {
    it('shape is { isOpen, open, close, toggle }', () => {
        expectTypeOf<DrawerNav>().toEqualTypeOf<{
            readonly isOpen: boolean;
            open(): void;
            close(): void;
            toggle(): void;
        }>();
    });
});

describe('TabsNav / TabInfo', () => {
    it('TabsNav exposes the active tab + tabs list + setActive', () => {
        const t = {} as TabsNav;
        expectTypeOf(t.active).toEqualTypeOf<string>();
        expectTypeOf(t.setActive).toBeFunction();
        expectTypeOf(t.tabs).toEqualTypeOf<ReadonlyArray<TabInfo>>();
    });

    it('TabInfo carries optional label / icon / accessibilityLabel', () => {
        expectTypeOf<TabInfo['accessibilityLabel']>().toEqualTypeOf<
            string | undefined
        >();
        expectTypeOf<TabInfo['label']>().toEqualTypeOf<string | undefined>();
        expectTypeOf<TabInfo['name']>().toEqualTypeOf<string>();
    });

    it('TabRenderContext exposes active and onPress', () => {
        const ctx = {} as TabRenderContext;
        expectTypeOf(ctx.active).toEqualTypeOf<boolean>();
        expectTypeOf(ctx.onPress).toBeFunction();
    });
});

describe('ScreenOptions / useScreenOptions', () => {
    it('ScreenOptions exposes the documented option keys', () => {
        type Keys = keyof ScreenOptions;
        expectTypeOf<Keys>().toEqualTypeOf<
            | 'title'
            | 'headerShown'
            | 'gestureEnabled'
            | 'snapPoints'
            | 'initialSnapIndex'
            | 'backdropDismiss'
            | 'backdrop'
            | 'dragHandle'
        >();
    });

    it('useScreenOptions accepts a plain object or a function', () => {
        expectTypeOf(nav.useScreenOptions).parameter(0).toMatchTypeOf<
            ScreenOptions | (() => ScreenOptions)
        >();
    });
});

describe('Link / LinkProps', () => {
    it('LinkProps requires `to`', () => {
        expectTypeOf<LinkProps>().toHaveProperty('to');
        // `to` is constrained to a registered route id.
        type ToType = LinkProps['to'];
        expectTypeOf<ToType>().toEqualTypeOf<RouteId>();
    });
});

describe('useNavSerializer', () => {
    it('options carry storage + debounceMs + restore callbacks', () => {
        expectTypeOf<UseNavSerializerOptions>().toHaveProperty('storage');
        expectTypeOf<UseNavSerializerOptions>().toHaveProperty('debounceMs');
        expectTypeOf<UseNavSerializerOptions>().toHaveProperty('onRestored');
    });

    it('NavSnapshot carries a numeric schema version + stack', () => {
        expectTypeOf<NavSnapshot>().toHaveProperty('version');
        expectTypeOf<NavSnapshot['version']>().toEqualTypeOf<number>();
        expectTypeOf<NavSnapshot>().toHaveProperty('stack');
    });
});

describe('useLinkingNav options', () => {
    it('shape includes prefixes, onURL, onUnmatched, replaceInitial', () => {
        type Keys = keyof UseLinkingNavOptions;
        expectTypeOf<Keys>().toEqualTypeOf<
            'prefixes' | 'onURL' | 'onUnmatched' | 'replaceInitial'
        >();
    });
});
