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
import { useScreenChrome } from '@sigx/lynx-navigation';

export type NavHeaderBackground = 'base-100' | 'base-200' | 'base-300' | 'transparent';

export type NavHeaderProps =
    /** Surface color token. Default 'base-200'. */
    & Define.Prop<'background', NavHeaderBackground, false>
    /** Show a separator line at the bottom. Default true. */
    & Define.Prop<'bordered', boolean, false>
    /** Replace the back button entirely. Receives `pop` so the custom node can wire its own tap handler. */
    & Define.Prop<'renderBack', (ctx: { pop: () => void }) => JSXElement, false>;

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

        const left = chrome.headerLeft?.()
            ?? (chrome.canGoBack
                ? (props.renderBack
                    ? props.renderBack({ pop: chrome.pop })
                    : <DefaultBackButton onPress={chrome.pop} />)
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
        <view
            bindtap={() => props.onPress()}
            accessibility-element={true}
            accessibility-label="Back"
            accessibility-trait="button"
            class="px-2 py-2"
        >
            <text class="text-primary text-base">‹ Back</text>
        </view>
    );
});
