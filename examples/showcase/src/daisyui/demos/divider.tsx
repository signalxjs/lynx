import { component } from '@sigx/lynx';
import { Col, Divider, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Divider — a thin rule separating content. `vertical` switches it to a
 * column divider, `color` overrides the line color, and `margin` adds
 * spacing on the rule's axis. Slot content (#212) renders the daisyUI
 * `line · label · line` composition with the label centered.
 */
export const dividerDemo: DaisyComponentDemo = {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal & vertical rules, custom color, and a labeled separator',
    icon: { set: 'lucide', name: 'separator-horizontal' },
    sections: [
        {
            title: 'Horizontal',
            note: 'Default rule between stacked content',
            Demo: component(() => () => (
                <Col class="w-64">
                    <Text>Above</Text>
                    <Divider />
                    <Text>Below</Text>
                </Col>
            )),
        },
        {
            title: 'Vertical',
            note: 'vertical splits a row of content',
            Demo: component(() => () => (
                <Row class="h-16 bg-base-200 rounded" align="center" padding={12}>
                    <Text>Left</Text>
                    <Divider vertical />
                    <Text>Right</Text>
                </Row>
            )),
        },
        {
            title: 'Custom color',
            note: 'color overrides the rule color (any CSS color)',
            Demo: component(() => () => (
                <Col class="w-64">
                    <Text>Above</Text>
                    <Divider color="var(--color-primary)" margin={8} />
                    <Text>Below</Text>
                </Col>
            )),
        },
        {
            title: 'Labeled',
            note: 'slot content centers between two flanking lines',
            Demo: component(() => () => (
                <Col class="w-64" gap={12}>
                    <Divider>
                        <Text class="opacity-60 text-xs">OR</Text>
                    </Divider>
                    <Divider color="var(--color-primary)">
                        <Text class="text-primary text-xs">CONTINUE WITH</Text>
                    </Divider>
                </Col>
            )),
        },
    ],
};
