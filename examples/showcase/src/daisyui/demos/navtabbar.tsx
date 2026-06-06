import { component, signal } from '@sigx/lynx';
import { Col, Row, Tabs, Text } from '@sigx/lynx-daisyui';
import { Icon } from '@sigx/lynx-icons';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * NavTabBar — the daisy-themed bottom tab bar for `@sigx/lynx-navigation`.
 *
 * Unlike the standalone `Tabs`, `NavTabBar` is *navigation-driven*: it calls
 * `useTabs()` at setup to read the active tab + tab list and dispatch changes,
 * so it can only be mounted inside a `<Tabs>` / `<Tabs.Screen>` tree from
 * `@sigx/lynx-navigation` (calling `useTabs()` elsewhere throws). It takes no
 * item props — the tab list comes from navigation. Props are presentational:
 * `position` ('top' | 'bottom'), `background` (base-100/200/300 | transparent),
 * `bordered`, and `renderTab` for full per-tab override.
 *
 * Because a plain catalog page has no `<Tabs>` navigation context, the
 * sections below reproduce the bar's *visual* treatment with the standalone
 * `Tabs` strip + icons rather than mounting the context-bound component. Use
 * `NavTabBar` itself only inside the navigation container (see the app shell).
 */
export const navtabbarDemo: DaisyComponentDemo = {
    id: 'navtabbar',
    title: 'NavTabBar',
    description: 'Navigation-driven bottom tab bar — position, surface & active-item styling',
    icon: { set: 'lucide', name: 'dock' },
    sections: [
        {
            title: 'Bottom bar (visual)',
            note: 'NavTabBar mounts inside a <Tabs> navigator; this mirrors its bottom-bar treatment',
            Demo: component(() => {
                const active = signal('home');
                const items = [
                    { name: 'home', label: 'Home', icon: 'house' },
                    { name: 'search', label: 'Search', icon: 'search' },
                    { name: 'profile', label: 'Profile', icon: 'user' },
                ];
                return () => (
                    <Col class="w-72 border-t border-base-300 bg-base-200">
                        <Row class="justify-around">
                            {items.map((it) => {
                                const on = active.value === it.name;
                                return (
                                    <Tabs.Tab
                                        key={it.name}
                                        value={it.name}
                                        active={on}
                                        onPress={() => { active.value = it.name; }}
                                        class="flex-1 flex-col items-center justify-center py-3 gap-1"
                                    >
                                        <Icon
                                            set="lucide"
                                            name={it.icon}
                                            size={22}
                                            variant={on ? 'primary' : 'base-content'}
                                            class={on ? undefined : 'opacity-60'}
                                        />
                                        <Text class={on ? 'text-sm text-primary font-semibold' : 'text-sm opacity-60'}>
                                            {it.label}
                                        </Text>
                                    </Tabs.Tab>
                                );
                            })}
                        </Row>
                    </Col>
                );
            }),
        },
        {
            title: 'Top bar (visual)',
            note: 'position="top" puts the separator on the bottom edge instead',
            Demo: component(() => {
                const active = signal('all');
                const items = [
                    { name: 'all', label: 'All' },
                    { name: 'mentions', label: 'Mentions' },
                    { name: 'archived', label: 'Archived' },
                ];
                return () => (
                    <Col class="w-72 border-b border-base-300 bg-base-200">
                        <Row class="justify-around">
                            {items.map((it) => {
                                const on = active.value === it.name;
                                return (
                                    <Tabs.Tab
                                        key={it.name}
                                        value={it.name}
                                        label={it.label}
                                        active={on}
                                        onPress={() => { active.value = it.name; }}
                                        class="flex-1 items-center justify-center py-3"
                                    />
                                );
                            })}
                        </Row>
                    </Col>
                );
            }),
        },
    ],
};
