import { component } from '@sigx/lynx';
import { Col, Divider, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Divider — a thin rule separating content. It's a self-closing element
 * (no label slot): `vertical` switches it to a column divider, `color`
 * overrides the line color, and `margin` adds spacing on the rule's axis.
 *
 * For a labeled separator, pair a `Divider` with `Text` in a `Row`/`Col`.
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
            title: 'Labeled (composed)',
            note: 'Divider has no label slot — compose one with Text',
            Demo: component(() => () => (
                <Row class="w-64" align="center" gap={8}>
                    <Divider class="flex-1" />
                    <Text class="opacity-60 text-xs">OR</Text>
                    <Divider class="flex-1" />
                </Row>
            )),
        },
    ],
};
