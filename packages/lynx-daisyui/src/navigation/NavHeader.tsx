/**
 * `<NavHeader>` — daisy-themed header bar for `@sigx/lynx-navigation`.
 *
 * Pairs with `<Stack>` from `@sigx/lynx-navigation`:
 *
 * ```tsx
 * <Stack initialRoute="tripsHome">
 *   <NavHeader />
 * </Stack>
 * ```
 *
 * Reads the focused screen's options + slot fills via
 * `useScreenChrome()`, applies daisy theming (base-200 surface, bottom
 * separator, native-ish horizontal layout with centred title).
 *
 * The navigation package's own `<Header />` is intentionally headless —
 * no flex-row, no padding, no theme — for consumers who want to do all
 * styling themselves. This component is the batteries-included variant
 * for daisyui consumers.
 */
import { component, type Define, type JSXElement } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { Icon, type IconSpec } from '@sigx/lynx-icons';
import { useScreenChrome } from '@sigx/lynx-navigation';
import { PRESSED_SCALE, PRESSED_OPACITY } from '@sigx/lynx-zero';

export type NavHeaderBackground = 'base-100' | 'base-200' | 'base-300' | 'transparent';

export type NavHeaderProps =
    /** Surface color token. Default 'base-200'. */
    & Define.Prop<'background', NavHeaderBackground, false>
    /** Show a separator line at the bottom. Default true. */
    & Define.Prop<'bordered', boolean, false>
    /**
     * Render the back chevron from an `IconSpec` (e.g. `{ set: 'lucide',
     * name: 'chevron-left' }`). The icon is rendered with
     * `variant="primary"`, which `<ThemeProvider>`'s color resolver maps
     * to the daisy primary hex and substitutes into the SVG `fill=`.
     * Wrapped in a Pressable wired to the stack's pop. Falls back to the
     * default "‹ Back" text when not provided. Ignored when `renderBack`
     * or `<Screen.HeaderLeft>` is also supplied — those win.
     */
    & Define.Prop<'backIcon', IconSpec, false>
    /** Full override: render any JSX for the back button. Takes priority over `backIcon`. */
    & Define.Prop<'renderBack', (ctx: { pop: () => void }) => JSXElement, false>;

/** Pixel size used when rendering the back-button icon from an `IconSpec`. */
const NAV_HEADER_ICON_SIZE = 22;

const backgroundClass: Record<NavHeaderBackground, string> = {
    'base-100': 'bg-base-100',
    'base-200': 'bg-base-200',
    'base-300': 'bg-base-300',
    'transparent': '',
};

export const NavHeader = component<NavHeaderProps>(({ props }) => {
    const chrome = useScreenChrome();

    return () => {
        if (!chrome.headerShown) return null;

        // Full override: <Screen.Header> rendered.
        const override = chrome.header;
        if (override) return override();

        const bg = backgroundClass[props.background ?? 'base-200'];
        const bordered = props.bordered ?? true;
        const borderClass = bordered ? 'border-b border-base-300' : '';
        const containerClass = [
            'flex flex-row items-center px-3',
            'h-12', // ~48dp / standard nav bar height
            bg,
            borderClass,
        ].filter(Boolean).join(' ');

        // Resolution order: <Screen.HeaderLeft> slot fill → custom renderBack
        // → backIcon spec → default text. The spec path renders `<Icon>`
        // with `variant="primary"`, which the daisy resolver maps to the
        // primary hex and substitutes into the SVG `fill=`.
        const left = chrome.headerLeft?.()
            ?? (chrome.canGoBack
                ? (props.renderBack
                    ? props.renderBack({ pop: chrome.pop })
                    : (props.backIcon
                        ? <BackIconButton spec={props.backIcon} onPress={chrome.pop} />
                        : <DefaultBackButton onPress={chrome.pop} />))
                : null);

        const right = chrome.headerRight?.() ?? null;

        return (
            <view class={containerClass}>
                {/* Left zone — fixed min width so the centred title is stable */}
                <view class="flex flex-row items-center" style={{ minWidth: 56 }}>
                    {left}
                </view>
                {/* Title fills the middle */}
                <view class="flex-1 items-center justify-center">
                    <text class="text-base-content text-base font-semibold">
                        {chrome.title}
                    </text>
                </view>
                {/* Right zone — matches left min width for symmetry */}
                <view
                    class="flex flex-row items-center justify-end"
                    style={{ minWidth: 56 }}
                >
                    {right}
                </view>
            </view>
        );
    };
});

const DefaultBackButton = component<Define.Prop<'onPress', () => void, true>>(({ props }) => {
    return () => (
        <Pressable
            class="px-2 py-2"
            pressedScale={PRESSED_SCALE}
            pressedOpacity={PRESSED_OPACITY}
            longPressDuration={0}
            accessibility-element={true}
            accessibility-label="Back"
            accessibility-trait="button"
            onPress={() => props.onPress()}
        >
            <text class="text-primary text-base">‹ Back</text>
        </Pressable>
    );
});

const BackIconButton = component<
    & Define.Prop<'spec', IconSpec, true>
    & Define.Prop<'onPress', () => void, true>
>(({ props }) => {
    return () => (
        <Pressable
            class="px-2 py-2"
            pressedScale={PRESSED_SCALE}
            pressedOpacity={PRESSED_OPACITY}
            longPressDuration={0}
            accessibility-element={true}
            accessibility-label="Back"
            accessibility-trait="button"
            onPress={() => props.onPress()}
        >
            {/* `variant="primary"` is resolved by `<ThemeProvider>`'s
                color resolver to the daisy primary hex and substituted
                into the SVG `fill=` attribute — the only mechanism that
                reaches Lynx's `<svg content=…>` parsed content, which
                doesn't inherit host `color` or evaluate CSS vars in
                attribute values. */}
            <Icon
                set={props.spec.set}
                name={props.spec.name}
                size={NAV_HEADER_ICON_SIZE}
                variant="primary"
            />
        </Pressable>
    );
});
