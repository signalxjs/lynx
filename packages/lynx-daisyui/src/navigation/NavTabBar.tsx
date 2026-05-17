/**
 * `<NavTabBar>` — daisy-themed tab bar for `@sigx/lynx-navigation`.
 *
 * Pairs with `<Tabs>` + `<Tabs.Screen>` from `@sigx/lynx-navigation`:
 * subscribes to `useTabs()` for the active tab + tab list, dispatches
 * tab changes via `setActive`. Pure UI / styling; the navigation
 * package owns state.
 *
 * Default visual treatment: bottom navigation bar — base-200 background,
 * top separator line, active label in primary color.
 *
 * Use the standalone daisy `<Tabs>` / `<Tab>` (also exported from this
 * package) instead when you want generic tab UI not driven by navigation
 * state (e.g. segmented controls inside a settings panel).
 */
import { component, type Define, type JSXElement } from '@sigx/lynx';
import { useTabs, type TabInfo } from '@sigx/lynx-navigation';

/** Rendering context passed to a `renderTab` consumer. */
export interface NavTabRenderContext {
    /** True when this tab is currently active. Reactive — re-runs render on change. */
    readonly active: boolean;
    /** Activates this tab. Use as a `bindtap` handler on the rendered node. */
    onPress(): void;
}

export type NavTabBarPosition = 'top' | 'bottom';
export type NavTabBarBackground = 'base-100' | 'base-200' | 'base-300' | 'transparent';

export type NavTabBarProps =
    /** Where the bar sits in the layout — controls which edge gets the separator border. Default 'bottom'. */
    & Define.Prop<'position', NavTabBarPosition, false>
    /** Surface color token. Default 'base-200'. */
    & Define.Prop<'background', NavTabBarBackground, false>
    /** Show a separator line on the edge opposite `position`. Default true. */
    & Define.Prop<'bordered', boolean, false>
    /** Replace per-tab rendering entirely. */
    & Define.Prop<'renderTab', (info: TabInfo, ctx: NavTabRenderContext) => JSXElement, false>;

const backgroundClass: Record<NavTabBarBackground, string> = {
    'base-100': 'bg-base-100',
    'base-200': 'bg-base-200',
    'base-300': 'bg-base-300',
    'transparent': '',
};

export const NavTabBar = component<NavTabBarProps>(({ props }) => {
    const nav = useTabs();
    return () => {
        const tabs = nav.tabs;
        const active = nav.active;
        const renderer = props.renderTab;
        const position = props.position ?? 'bottom';
        const bg = backgroundClass[props.background ?? 'base-200'];
        const bordered = props.bordered ?? true;
        // Bottom tab bar → top border. Top tab bar → bottom border.
        const borderClass = bordered
            ? (position === 'bottom' ? 'border-t border-base-300' : 'border-b border-base-300')
            : '';
        const containerClass = ['flex flex-row', bg, borderClass].filter(Boolean).join(' ');

        return (
            <view accessibility-element={false} class={containerClass}>
                {tabs.map((info) => {
                    const isActive = info.name === active;
                    const onPress = () => nav.setActive(info.name);
                    if (renderer) {
                        return renderer(info, { active: isActive, onPress });
                    }
                    return (
                        <DefaultNavTab
                            info={info}
                            active={isActive}
                            onPress={onPress}
                        />
                    );
                })}
            </view>
        );
    };
});

const DefaultNavTab = component<
    & Define.Prop<'info', TabInfo, true>
    & Define.Prop<'active', boolean, true>
    & Define.Prop<'onPress', () => void, true>
>(({ props }) => {
    return () => {
        const label = props.info.label ?? props.info.name;
        const a11y = props.info.accessibilityLabel ?? label;
        const textColor = props.active ? 'text-primary font-semibold' : 'text-base-content opacity-60';
        return (
            <view
                bindtap={() => props.onPress()}
                accessibility-element={true}
                accessibility-label={a11y}
                accessibility-trait="button"
                accessibility-status={props.active ? 'selected' : undefined}
                class="flex-1 items-center justify-center py-3"
            >
                {props.info.icon ?? null}
                <text class={`text-sm ${textColor}`}>{label}</text>
            </view>
        );
    };
});
