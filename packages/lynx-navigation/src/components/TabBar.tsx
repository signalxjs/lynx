/**
 * `<TabBar>` — headless default chrome for `<Tabs>`.
 *
 * Renders the active-tab buttons reading from the enclosing `useTabs()`
 * navigator. Intentionally **unstyled** — this lives in the (theme-less)
 * navigation package, so it ships pure structure + accessibility wiring.
 * Themed chrome belongs in a UI-kit package: see `<NavTabBar />` in
 * `@sigx/lynx-daisyui` for the daisy-themed equivalent.
 *
 * Use this directly only if you want to handle styling yourself via the
 * `renderTab` prop. For a "looks like a tab bar out of the box" component,
 * pull `<NavTabBar />` from `@sigx/lynx-daisyui` (or your own UI kit).
 *
 * Customization:
 *   - `renderTab`: a function `(info, ctx) => JSX` that fully replaces the
 *     default button rendering for each tab. `ctx.active` tells the
 *     consumer whether this tab is currently focused; `ctx.onPress`
 *     activates the tab. **Recommended** for any visual treatment.
 *
 * Accessibility (baked into the default button — the one structural
 * concern this component keeps):
 *   - `accessibility-label` from `info.accessibilityLabel ?? info.label ?? info.name`.
 *   - `accessibility-element="true"` so screen readers see the whole pill.
 *   - `accessibility-trait="button"` and a `selected` flag on the active
 *     one so VoiceOver/TalkBack announces focus state on tab switch.
 */
import {
    component,
    type Define,
    type JSXElement,
} from '@sigx/lynx';
import { useTabs, type TabInfo } from './Tabs';

/** Rendering context passed to a `renderTab` consumer. */
export interface TabRenderContext {
    /** True when this tab is currently active. Reactive — re-runs render on change. */
    readonly active: boolean;
    /** Activates this tab. Use as a `bindtap` handler on the rendered node. */
    onPress(): void;
}

type TabBarProps =
    & Define.Prop<'renderTab', (info: TabInfo, ctx: TabRenderContext) => JSXElement>;

/**
 * Default per-tab button. Plain `<view>` with a `<text>` inside, an
 * `accessibility-*` cluster for screen readers, and a tap handler. No
 * styling beyond a minimal active-state opacity hint — consumers that
 * want branded chrome pass `renderTab` or use a UI-kit-provided tab bar
 * (e.g. `<NavTabBar />` from `@sigx/lynx-daisyui`).
 */
const DefaultTabButton = component<
    & Define.Prop<'info', TabInfo, true>
    & Define.Prop<'active', boolean, true>
    & Define.Prop<'onPress', () => void, true>
>(({ props }) => {
    return () => {
        const label = props.info.label ?? props.info.name;
        const a11y = props.info.accessibilityLabel ?? label;
        return (
            <view
                bindtap={() => props.onPress()}
                accessibility-element={true}
                accessibility-label={a11y}
                accessibility-trait="button"
                accessibility-status={props.active ? 'selected' : undefined}
                style={{ opacity: props.active ? 1 : 0.6 }}
            >
                {props.info.icon ?? null}
                <text>{label}</text>
            </view>
        );
    };
});

export const TabBar = component<TabBarProps>(({ props }) => {
    const nav = useTabs();
    return () => {
        // Reading `nav.tabs` and `nav.active` here ties this render to both
        // the registration list and the active signal — switching active or
        // adding/removing a `<Tabs.Screen>` updates the bar reactively.
        const tabs = nav.tabs;
        const active = nav.active;
        const renderer = props.renderTab;
        return (
            <view accessibility-element={false}>
                {tabs.map((info) => {
                    const isActive = info.name === active;
                    const onPress = () => nav.setActive(info.name);
                    if (renderer) {
                        return renderer(info, { active: isActive, onPress });
                    }
                    return (
                        <DefaultTabButton
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
