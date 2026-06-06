import { component } from '@sigx/lynx';
import { Badge, Col, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Badge — colour variants, the size ramp and the outline modifier.
 *
 * Badge is a presentational inline label with no interactive state, so all
 * sections are static.
 */
export const badgeDemo: DaisyComponentDemo = {
    id: 'badge',
    title: 'Badge',
    description: 'Colour variants, size ramp and outline modifier',
    icon: { set: 'lucide', name: 'badge-check' },
    sections: [
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Badge variant="primary">Primary</Badge>
                    <Badge variant="secondary">Secondary</Badge>
                    <Badge variant="accent">Accent</Badge>
                    <Badge variant="neutral">Neutral</Badge>
                    <Badge variant="info">Info</Badge>
                    <Badge variant="success">Success</Badge>
                    <Badge variant="warning">Warning</Badge>
                    <Badge variant="error">Error</Badge>
                    <Badge variant="ghost">Ghost</Badge>
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={8} align="center" class="flex-wrap">
                    <Badge variant="primary" size="xs">xs</Badge>
                    <Badge variant="primary" size="sm">sm</Badge>
                    <Badge variant="primary" size="md">md</Badge>
                    <Badge variant="primary" size="lg">lg</Badge>
                </Row>
            )),
        },
        {
            title: 'Outline',
            note: 'outline modifier across a few variants',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Badge variant="primary" outline>Primary</Badge>
                    <Badge variant="success" outline>Success</Badge>
                    <Badge variant="warning" outline>Warning</Badge>
                    <Badge variant="error" outline>Error</Badge>
                </Row>
            )),
        },
        {
            title: 'Inline with text',
            note: 'badges sit alongside running copy',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Row gap={6} align="center">
                        <Text>Inbox</Text>
                        <Badge variant="primary" size="sm">12</Badge>
                    </Row>
                    <Row gap={6} align="center">
                        <Text>Status</Text>
                        <Badge variant="success" size="sm">Active</Badge>
                    </Row>
                </Col>
            )),
        },
    ],
};
