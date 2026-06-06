import { component } from '@sigx/lynx';
import { Button, Col, NavDrawer, Text } from '@sigx/lynx-daisyui';
import { useDrawer } from '@sigx/lynx-navigation';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * NavDrawer — the daisy-themed off-canvas drawer for `@sigx/lynx-navigation`.
 *
 * Self-contained: it composes the primitive `<Drawer>` internally as its own
 * state provider, so it works standalone — no surrounding navigation tree
 * required. Descendants of its `default` slot call `useDrawer()` to get
 * `{ isOpen, open, close, toggle }`; the `sidebar` slot is the panel content.
 * Presentational props: `side` ('left' | 'right'), `background`, `bordered`,
 * `backdrop`, `width` (px) and `initialOpen`.
 *
 * The drawer fills its parent (absolute overlays at 100% × 100%), so each demo
 * boxes it to a fixed size to keep it inert inside the page. Tap the toggle to
 * slide the panel in; tap the scrim (or toggle again) to dismiss.
 */

/** Trigger that lives inside the drawer's default slot so `useDrawer()` resolves. */
const DrawerToggle = component(() => {
    const drawer = useDrawer();
    return () => (
        <Col gap={8} class="p-4 items-start">
            <Text class="opacity-70">Main content area.</Text>
            <Button color="primary" size="sm" onPress={() => drawer.toggle()}>
                Toggle drawer
            </Button>
        </Col>
    );
});

const SidebarMenu = component(() => () => (
    <Col gap={4} class="p-4">
        <Text class="font-semibold">Menu</Text>
        <Text class="opacity-70">Home</Text>
        <Text class="opacity-70">Library</Text>
        <Text class="opacity-70">Settings</Text>
    </Col>
));

export const navdrawerDemo: DaisyComponentDemo = {
    id: 'navdrawer',
    title: 'NavDrawer',
    description: 'Off-canvas slide-in drawer — side, surface, backdrop & live toggle',
    icon: { set: 'lucide', name: 'panel-left' },
    sections: [
        {
            title: 'Left drawer',
            note: 'tap “Toggle drawer” to slide the panel in from the left',
            Demo: component(() => () => (
                <Col class="w-72 border border-base-300 rounded-box overflow-hidden" style={{ height: 200 }}>
                    <NavDrawer side="left" width={200} slots={{ sidebar: () => <SidebarMenu /> }}>
                        <DrawerToggle />
                    </NavDrawer>
                </Col>
            )),
        },
        {
            title: 'Right · no backdrop',
            note: 'side="right" with backdrop={false}',
            Demo: component(() => () => (
                <Col class="w-72 border border-base-300 rounded-box overflow-hidden" style={{ height: 200 }}>
                    <NavDrawer
                        side="right"
                        width={200}
                        backdrop={false}
                        background="base-200"
                        slots={{ sidebar: () => <SidebarMenu /> }}
                    >
                        <DrawerToggle />
                    </NavDrawer>
                </Col>
            )),
        },
        {
            title: 'Open at mount',
            note: 'initialOpen mounts the panel already slid-in',
            Demo: component(() => () => (
                <Col class="w-72 border border-base-300 rounded-box overflow-hidden" style={{ height: 200 }}>
                    <NavDrawer side="left" width={200} initialOpen slots={{ sidebar: () => <SidebarMenu /> }}>
                        <DrawerToggle />
                    </NavDrawer>
                </Col>
            )),
        },
    ],
};
