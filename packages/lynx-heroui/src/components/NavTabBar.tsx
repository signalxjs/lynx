/**
 * `<NavTabBar>` — HeroUI-themed tab bar for `@sigx/lynx-navigation`.
 *
 * Inside a `<Tabs>` / `<Tabs.Screen>` tree it is navigation-driven via
 * `useTabs()`. With an explicit `items` list it runs standalone (no nav
 * context) — `activeId` controls the highlight, presses surface via
 * `onSelect`. Mode is fixed at mount. Icons themed via `<Icon variant>` →
 * the ThemeProvider's icon-color resolver (active hero palette).
 */
import { component, type Define, type JSXElement } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { Icon, type IconSpec } from '@sigx/lynx-icons';
import { useTabs, type TabInfo } from '@sigx/lynx-navigation';
import { PRESSED_SCALE, PRESSED_OPACITY } from '@sigx/lynx-zero';

const isIconSpec = (v: unknown): v is IconSpec =>
    typeof v === 'object' && v !== null && 'set' in v && 'name' in v
    && typeof (v as { set: unknown }).set === 'string'
    && typeof (v as { name: unknown }).name === 'string';

export interface NavTabRenderContext {
    readonly active: boolean;
    onPress(): void;
}

export type NavTabBarPosition = 'top' | 'bottom';
export type NavTabBarBackground = 'base-100' | 'base-200' | 'base-300' | 'transparent';

export type NavTabBarProps =
    /** Where the bar sits — controls which edge gets the separator. Default 'bottom'. */
    & Define.Prop<'position', NavTabBarPosition, false>
    /** Surface color token. Default 'base-200'. */
    & Define.Prop<'background', NavTabBarBackground, false>
    /** Show a separator on the edge opposite `position`. Default true. */
    & Define.Prop<'bordered', boolean, false>
    /** Replace per-tab rendering entirely. */
    & Define.Prop<'renderTab', (info: TabInfo, ctx: NavTabRenderContext) => JSXElement, false>
    /** Standalone mode: explicit tab list (no `useTabs()`). Mode fixed at mount. */
    & Define.Prop<'items', ReadonlyArray<TabInfo>, false>
    /** Standalone mode: active tab name. */
    & Define.Prop<'activeId', string, false>
    /** Tab pressed — payload is the tab's `name`. */
    & Define.Event<'select', string>;

const backgroundClass: Record<NavTabBarBackground, string> = {
    'base-100': 'bg-base-100',
    'base-200': 'bg-base-200',
    'base-300': 'bg-base-300',
    'transparent': '',
};

export const NavTabBar = component<NavTabBarProps>(({ props, emit }) => {
    const standalone = props.items != null;
    const nav = standalone ? null : useTabs();
    return () => {
        const tabs = standalone ? (props.items ?? []) : nav!.tabs;
        const active = standalone ? props.activeId : nav!.active;
        const renderer = props.renderTab;
        const position = props.position ?? 'bottom';
        const bg = backgroundClass[props.background ?? 'base-200'];
        const bordered = props.bordered ?? true;
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
                    if (renderer) return renderer(info, { active: isActive, onPress });
                    return <DefaultNavTab info={info} active={isActive} onPress={onPress} />;
                })}
            </view>
        );
    };
});

const TAB_ICON_SIZE = 22;

const DefaultNavTab = component<
    & Define.Prop<'info', TabInfo, true>
    & Define.Prop<'active', boolean, true>
    & Define.Prop<'onPress', () => void, true>
>(({ props }) => {
    return () => {
        const label = props.info.label ?? props.info.name;
        const a11y = props.info.accessibilityLabel ?? label;
        const labelTone = props.active ? 'text-primary' : 'text-base-content opacity-60';
        const weight = props.active ? 'font-semibold' : '';
        const icon = props.info.icon;
        // `<Icon variant>` is resolved to the active hero palette hex and
        // substituted into the SVG `fill=`; inactive layers `opacity-60` on the
        // outer element (opacity propagates to the raster).
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
