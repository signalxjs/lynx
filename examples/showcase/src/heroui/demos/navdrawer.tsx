import { component } from '@sigx/lynx';
import { Button, Col, Text } from '@sigx/lynx-heroui';
import { NavDrawer } from '@sigx/lynx-heroui/navigation';
import { useDrawer } from '@sigx/lynx-navigation';
import type { HeroComponentDemo } from '../registry.js';

/**
 * NavDrawer — the HeroUI-themed off-canvas drawer for `@sigx/lynx-navigation`.
 * Self-contained: it composes the primitive `<Drawer>` internally, so it works
 * standalone. Descendants of the `default` slot call `useDrawer()`; the
 * `sidebar` slot is the panel. Each demo boxes it to a fixed size since the
 * drawer fills its parent. Tap the toggle to slide in; tap the scrim to dismiss.
 */
const DrawerToggle = component(() => {
    const drawer = useDrawer();
    return () => (
        <Col gap={8} class="p-4 items-start">
            <Text class="opacity-70">Main content area.</Text>
            <Button color="primary" size="sm" onPress={() => drawer.toggle()}>Toggle drawer</Button>
        </Col>
    );
});

const SidebarMenu = component(() => () => (
    <Col gap={4} class="p-4">
        <Text weight="semibold">Menu</Text>
        <Text class="opacity-70">Home</Text>
        <Text class="opacity-70">Library</Text>
        <Text class="opacity-70">Settings</Text>
    </Col>
));

export const navdrawerDemo: HeroComponentDemo = {
    id: 'navdrawer',
    title: 'NavDrawer',
    description: 'Off-canvas slide-in drawer — side, surface, backdrop & live toggle',
    icon: { set: 'lucide', name: 'panel-left' },
    sections: [
        {
            title: 'Left drawer',
            note: 'tap “Toggle drawer” to slide the panel in from the left',
            Demo: component(() => () => (
                <Col class="border border-base-300 overflow-hidden" style={{ height: 200, borderRadius: 14 }}>
                    <NavDrawer side="left" width={200} slots={{ sidebar: () => <SidebarMenu /> }}>
                        <DrawerToggle />
                    </NavDrawer>
                </Col>
            )),
        },
        {
            title: 'Right drawer · primary surface',
            note: 'side="right" + background="primary"',
            Demo: component(() => () => (
                <Col class="border border-base-300 overflow-hidden" style={{ height: 200, borderRadius: 14 }}>
                    <NavDrawer side="right" width={200} background="primary" slots={{ sidebar: () => <SidebarMenu /> }}>
                        <DrawerToggle />
                    </NavDrawer>
                </Col>
            )),
        },
    ],
};
