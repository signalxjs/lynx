/**
 * `<TabBar>` — default chrome for `<Tabs>`.
 *
 * Renders a row of tab buttons reading from the enclosing `useTabs()`
 * navigator. Active tab is highlighted via the `active` prop on each
 * default button (consumers can re-style via `renderTab`).
 *
 * Customization knobs:
 *   - `renderTab`: a function `(info, ctx) => JSX` that fully replaces the
 *     default button rendering for each tab. `ctx.active` tells the
 *     consumer whether this tab is currently focused; `ctx.onPress`
 *     activates the tab.
 *
 * Accessibility:
 *   - Each default button gets `accessibility-label` from
 *     `info.accessibilityLabel ?? info.label ?? info.name`.
 *   - Each default button gets `accessibility-element="true"` so screen
 *     readers see the whole pill, not just the inner `<text>`.
 *   - Each default button gets `accessibility-trait="button"` and a
 *     `selected` flag on the active one so VoiceOver/TalkBack announces
 *     focus state on tab switch.
 *
 * Placement: mount inside `<Tabs>` alongside the `<Tabs.Screen>`s. Order
 * matters visually (place above or below the screen bodies depending on
 * the layout), and `<Tabs.Screen>` bodies all stack with `display:flex` so
 * the TabBar should be at a deterministic position in the JSX.
 */
import {
    component,
    type Define,
    type JSXElement,
} from '@sigx/lynx';
import { useTabs, type TabInfo } from './Tabs.js';

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
 * styling beyond a minimal active-state marker — consumers that want
 * branded chrome pass `renderTab`.
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
