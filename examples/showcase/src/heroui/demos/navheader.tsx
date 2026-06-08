import { component } from '@sigx/lynx';
import { Col, Row, Text } from '@sigx/lynx-heroui';
import { Icon } from '@sigx/lynx-icons';
import type { HeroComponentDemo } from '../registry.js';

/**
 * NavHeader — the HeroUI-themed, batteries-included header bar for
 * `@sigx/lynx-navigation`'s `<Stack>`. It reads the focused screen's chrome via
 * `useScreenChrome()`, so it only renders meaningfully inside a `<Stack>`.
 *
 * This catalog page already lives inside the app's live header, so mounting a
 * second `<NavHeader>` would just mirror the current screen. The sections below
 * present the bar's layout statically (chevron · centred title · trailing
 * action) to show the visual treatment; wire the real component into a
 * `<Stack>`.
 */
export const navheaderDemo: HeroComponentDemo = {
    id: 'navheader',
    title: 'NavHeader',
    description: 'Stack header bar — centred title, back chevron, surface & action zones',
    icon: { set: 'lucide', name: 'panel-top' },
    sections: [
        {
            title: 'Layout (visual)',
            note: 'back chevron (left) · centred title · trailing action (right)',
            Demo: component(() => () => (
                <Row align="center" class="h-12 px-3 border-b border-base-300 bg-base-200">
                    <Row class="items-center" style={{ minWidth: 56 }}>
                        <Icon set="lucide" name="chevron-left" size={22} variant="primary" />
                    </Row>
                    <Col class="flex-fill items-center justify-center">
                        <Text weight="semibold">Trip details</Text>
                    </Col>
                    <Row class="items-center justify-end" style={{ minWidth: 56 }}>
                        <Icon set="lucide" name="ellipsis" size={20} variant="base-content" />
                    </Row>
                </Row>
            )),
        },
        {
            title: 'Transparent · no border',
            note: 'background="transparent" + bordered={false}',
            Demo: component(() => () => (
                <Row align="center" class="h-12 px-3">
                    <Row class="items-center" style={{ minWidth: 56 }}>
                        <Text color="primary">‹ Back</Text>
                    </Row>
                    <Col class="flex-fill items-center justify-center">
                        <Text weight="semibold">Settings</Text>
                    </Col>
                    <Row style={{ minWidth: 56 }} />
                </Row>
            )),
        },
    ],
};
