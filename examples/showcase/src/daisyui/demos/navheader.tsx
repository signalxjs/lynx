import { component } from '@sigx/lynx';
import { Col, Row, Text } from '@sigx/lynx-daisyui';
import { Icon } from '@sigx/lynx-icons';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * NavHeader — the daisy-themed, batteries-included header bar for
 * `@sigx/lynx-navigation`'s `<Stack>`.
 *
 * It reads the focused screen's chrome via `useScreenChrome()` (title, back
 * button, header slots) and renders a centred title with a left back zone and
 * a right action zone. It owns no item props — everything comes from the
 * navigation stack. Presentational props: `background`, `bordered`,
 * `backIcon` (an `IconSpec` for the back chevron) and `renderBack` for a full
 * override.
 *
 * This catalog page is itself rendered inside the app's single live
 * `<NavHeader />` (see `App.tsx`). Mounting a *second* one here would just
 * mirror the current screen's chrome, so the sections below present the bar's
 * layout statically (a chevron + centred title + a trailing action) to show
 * the visual treatment. Wire the real component into a `<Stack>`.
 */
export const navheaderDemo: DaisyComponentDemo = {
    id: 'navheader',
    title: 'NavHeader',
    description: 'Stack header bar — centred title, back chevron, surface & action zones',
    icon: { set: 'lucide', name: 'panel-top' },
    sections: [
        {
            title: 'Layout (visual)',
            note: 'back chevron (left) · centred title · trailing action (right)',
            Demo: component(() => () => (
                <Col class="w-72 h-12 flex-row items-center px-3 border-b border-base-300 bg-base-200">
                    <Row class="items-center" style={{ minWidth: 56 }}>
                        <Icon set="lucide" name="chevron-left" size={22} variant="primary" />
                    </Row>
                    <Col class="flex-1 items-center justify-center">
                        <Text class="text-base font-semibold">Trip details</Text>
                    </Col>
                    <Row class="items-center justify-end" style={{ minWidth: 56 }}>
                        <Icon set="lucide" name="ellipsis" size={20} variant="base-content" />
                    </Row>
                </Col>
            )),
        },
        {
            title: 'Transparent · no border',
            note: 'background="transparent" + bordered={false}',
            Demo: component(() => () => (
                <Col class="w-72 h-12 flex-row items-center px-3">
                    <Row class="items-center" style={{ minWidth: 56 }}>
                        <Text class="text-primary text-base">‹ Back</Text>
                    </Row>
                    <Col class="flex-1 items-center justify-center">
                        <Text class="text-base font-semibold">Settings</Text>
                    </Col>
                    <Row style={{ minWidth: 56 }} />
                </Col>
            )),
        },
    ],
};
