import { component, signal } from '@sigx/lynx';
import { Col, NavTabBar, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * NavTabBar — the daisy-themed tab bar for `@sigx/lynx-navigation`.
 *
 * Two modes (#210): inside a `<Tabs>` / `<Tabs.Screen>` tree it is
 * *navigation-driven* — `useTabs()` supplies the tab list + active tab and
 * presses dispatch `setActive`. With an explicit `items` list it runs
 * *standalone* (no navigation context required): `activeId` controls the
 * highlight and presses surface through `onSelect`. The sections below mount
 * the real component in standalone mode; the app shell shows the
 * navigation-driven flavor.
 */
export const navtabbarDemo: DaisyComponentDemo = {
    id: 'navtabbar',
    title: 'NavTabBar',
    description: 'Tab bar — navigation-driven or standalone items, position & surface styling',
    icon: { set: 'lucide', name: 'dock' },
    sections: [
        {
            title: 'Bottom bar',
            note: 'standalone items + activeId; presses surface via onSelect',
            Demo: component(() => {
                const active = signal('home');
                const items = [
                    { name: 'home', label: 'Home', icon: { set: 'lucide', name: 'house' } as const },
                    { name: 'search', label: 'Search', icon: { set: 'lucide', name: 'search' } as const },
                    { name: 'profile', label: 'Profile', icon: { set: 'lucide', name: 'user' } as const },
                ];
                return () => (
                    <Col gap={8} class="w-72">
                        <NavTabBar
                            items={items}
                            activeId={active.value}
                            onSelect={(name) => { active.value = name; }}
                        />
                        <Text class="opacity-60 text-sm">active: {active.value}</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Top bar',
            note: 'position="top" puts the separator on the bottom edge instead',
            Demo: component(() => {
                const active = signal('all');
                const items = [
                    { name: 'all', label: 'All' },
                    { name: 'mentions', label: 'Mentions' },
                    { name: 'archived', label: 'Archived' },
                ];
                return () => (
                    <Col class="w-72">
                        <NavTabBar
                            position="top"
                            items={items}
                            activeId={active.value}
                            onSelect={(name) => { active.value = name; }}
                        />
                    </Col>
                );
            }),
        },
        {
            title: 'Surfaces',
            note: 'background tokens base-100 / base-300 / transparent',
            Demo: component(() => {
                const items = [
                    { name: 'a', label: 'One' },
                    { name: 'b', label: 'Two' },
                ];
                return () => (
                    <Col gap={12} class="w-72">
                        <NavTabBar items={items} activeId="a" background="base-100" />
                        <NavTabBar items={items} activeId="a" background="base-300" />
                        <NavTabBar items={items} activeId="a" background="transparent" bordered={false} />
                    </Col>
                );
            }),
        },
    ],
};
