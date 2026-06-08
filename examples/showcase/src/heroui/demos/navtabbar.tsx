import { component, signal } from '@sigx/lynx';
import { Col, NavTabBar, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/**
 * NavTabBar — the HeroUI-themed tab bar for `@sigx/lynx-navigation`. Inside a
 * `<Tabs>` tree it's navigation-driven; here it runs in standalone `items`
 * mode (no nav context) so the page can demo it directly. Icons + active tint
 * come from the hero palette.
 */
export const navtabbarDemo: HeroComponentDemo = {
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
                    <Col gap={8}>
                        <NavTabBar items={items} activeId={active.value} onSelect={(n) => { active.value = n; }} />
                        <Text size="sm" class="opacity-60">active: {active.value}</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Top bar (no icons)',
            note: 'position="top" moves the separator to the bottom edge',
            Demo: component(() => {
                const active = signal('all');
                const items = [
                    { name: 'all', label: 'All' },
                    { name: 'unread', label: 'Unread' },
                    { name: 'archived', label: 'Archived' },
                ];
                return () => (
                    <NavTabBar items={items} activeId={active.value} position="top" onSelect={(n) => { active.value = n; }} />
                );
            }),
        },
    ],
};
