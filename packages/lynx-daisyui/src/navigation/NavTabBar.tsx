/**
 * `<NavTabBar>` — daisy-themed tab bar for `@sigx/lynx-navigation`.
 *
 * Pairs with `<Tabs>` + `<Tabs.Screen>` from `@sigx/lynx-navigation`:
 * subscribes to `useTabs()` for the active tab + tab list, dispatches
 * tab changes via `setActive`. Pure UI / styling; the navigation
 * package owns state.
 *
 * **Standalone mode** (#210): pass an explicit `items` list and the bar
 * renders without any navigation context — `activeId` controls the active
 * tab and presses surface through `onSelect`. Fully controlled; nothing is
 * highlighted until `activeId` matches an item. For embedded usage: docs
 * pages, design-system galleries, previews. The mode is fixed at mount —
 * with `items` the navigator is never consulted, without it `useTabs()`
 * must resolve (throws outside `<Tabs>`).
 *
 * Default visual treatment: bottom navigation bar — base-200 background,
 * top separator line, active label in primary color.
 *
 * Use the standalone daisy `<Tabs>` / `<Tab>` (also exported from this
 * package) instead when you want generic tab UI not driven by navigation
 * state (e.g. segmented controls inside a settings panel).
 */
import { component, type Define, type JSXElement } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { Icon, type IconSpec } from '@sigx/lynx-icons';
import { useTabs, type TabInfo } from '@sigx/lynx-navigation';
import { PRESSED_SCALE, PRESSED_OPACITY } from '@sigx/lynx-zero';

/** Narrow `TabInfo.icon` to its `IconSpec` variant — the bar renders `<Icon>` for these. */
const isIconSpec = (v: unknown): v is IconSpec =>
    typeof v === 'object' && v !== null && 'set' in v && 'name' in v
    && typeof (v as { set: unknown }).set === 'string'
    && typeof (v as { name: unknown }).name === 'string';

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
    & Define.Prop<'renderTab', (info: TabInfo, ctx: NavTabRenderContext) => JSXElement, false>
    /**
     * Standalone mode: explicit tab list. When set the bar never calls
     * `useTabs()` — it renders these items, highlights `activeId` and
     * reports presses via `onSelect`. Mode is fixed at mount.
     */
    & Define.Prop<'items', ReadonlyArray<TabInfo>, false>
    /** Standalone mode: name of the active tab. No item is active when unset/unmatched. */
    & Define.Prop<'activeId', string, false>
    /** Tab pressed — payload is the tab's `name`. Fires in both modes (navigator mode also calls `setActive`). */
    & Define.Event<'select', string>;

const backgroundClass: Record<NavTabBarBackground, string> = {
    'base-100': 'bg-base-100',
    'base-200': 'bg-base-200',
    'base-300': 'bg-base-300',
    'transparent': '',
};

export const NavTabBar = component<NavTabBarProps>(({ props, emit }) => {
    // Mode is decided at mount: with `items` the navigator is never
    // consulted (so no <Tabs> ancestor is required); without it the bar
    // subscribes to the enclosing <Tabs>, which throws when absent.
    // `standalone` is captured here and branched on consistently below so a
    // later change to `items` can't mix navigator state with standalone
    // props (it renders an empty bar instead if `items` becomes undefined).
    const standalone = props.items != null;
    const nav = standalone ? null : useTabs();
    return () => {
        const tabs = standalone ? (props.items ?? []) : nav!.tabs;
        const active = standalone ? props.activeId : nav!.active;
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
                    const onPress = () => {
                        nav?.setActive(info.name);
                        emit('select', info.name);
                    };
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

/**
 * Pixel size the bar uses when rendering `<Icon>` from an `IconSpec`.
 * Matches the default tab-row height visually.
 */
const TAB_ICON_SIZE = 22;

const DefaultNavTab = component<
    & Define.Prop<'info', TabInfo, true>
    & Define.Prop<'active', boolean, true>
    & Define.Prop<'onPress', () => void, true>
>(({ props }) => {
    return () => {
        const label = props.info.label ?? props.info.name;
        const a11y = props.info.accessibilityLabel ?? label;
        // Label uses native CSS color via daisy `text-*` classes — Lynx's
        // `<text>` honors color inheritance normally. The icon path below
        // can't rely on the same trick (see comment there for why).
        const labelTone = props.active ? 'text-primary' : 'text-base-content opacity-60';
        const weight = props.active ? 'font-semibold' : '';
        const icon = props.info.icon;
        // For an `IconSpec`, render `<Icon>` with the matching daisy
        // variant. `<ThemeProvider>`'s color resolver maps `'primary'` /
        // `'base-content'` (etc.) to the current theme's hex value, which
        // `<Icon>` substitutes directly into the SVG `fill=` attribute —
        // Lynx's `<svg content=…>` parses inline SVG in isolation and
        // doesn't inherit host `color`, so class-based theming doesn't
        // reach the SVG content. Inactive layers `opacity-60` as a class
        // on the outer element (opacity does propagate to the raster).
        //
        // For a `JSXElement`, the consumer is in charge of styling — we
        // leave it untouched. They can opt into the same theming by
        // passing `variant="primary"` themselves.
        const iconVariant = props.active ? 'primary' : 'base-content';
        const iconClass = props.active ? undefined : 'opacity-60';
        const renderedIcon = isIconSpec(icon)
            ? <Icon set={icon.set} name={icon.name} size={TAB_ICON_SIZE} variant={iconVariant} class={iconClass} />
            : (icon ?? null);
        return (
            <Pressable
                class="flex-1 items-center justify-center py-3"
                pressedScale={PRESSED_SCALE}
                pressedOpacity={PRESSED_OPACITY}
                longPressDuration={0}
                accessibility-element={true}
                accessibility-label={a11y}
                accessibility-trait="button"
                accessibility-status={props.active ? 'selected' : undefined}
                onPress={() => props.onPress()}
            >
                {renderedIcon}
                <text class={`text-sm ${labelTone} ${weight}`}>{label}</text>
            </Pressable>
        );
    };
});
