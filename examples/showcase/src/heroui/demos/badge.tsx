import { component } from '@sigx/lynx';
import { Badge, Col, Row } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Badge — pill label; solid/flat/bordered, semantic colors, sizes. */
export const badgeDemo: HeroComponentDemo = {
    id: 'badge',
    title: 'Badge',
    description: 'Pill label — solid/flat/bordered, semantic colors, sizes',
    icon: { set: 'lucide', name: 'badge' },
    sections: [
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Badge color="primary">Primary</Badge>
                    <Badge color="secondary">Secondary</Badge>
                    <Badge color="success">Success</Badge>
                    <Badge color="warning">Warning</Badge>
                    <Badge color="error">Error</Badge>
                </Row>
            )),
        },
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Badge color="primary">Solid</Badge>
                    <Badge color="primary" variant="flat">Flat</Badge>
                    <Badge color="primary" variant="bordered">Bordered</Badge>
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={8} align="center" class="flex-wrap">
                    <Badge color="primary" size="sm">sm</Badge>
                    <Badge color="primary" size="md">md</Badge>
                    <Badge color="primary" size="lg">lg</Badge>
                </Row>
            )),
        },
    ],
};
