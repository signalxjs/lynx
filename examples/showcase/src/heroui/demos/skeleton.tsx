import { component } from '@sigx/lynx';
import { Col, Row, Skeleton } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Skeleton — pulsing placeholders. */
export const skeletonDemo: HeroComponentDemo = {
    id: 'skeleton',
    title: 'Skeleton',
    description: 'Pulsing placeholders — blocks and circles',
    icon: { set: 'lucide', name: 'square-dashed' },
    sections: [
        {
            title: 'Card placeholder',
            Demo: component(() => () => (
                <Row gap={12} align="center">
                    <Skeleton circle width={48} />
                    <Col gap={8} class="flex-fill">
                        <Skeleton height={14} width="60%" />
                        <Skeleton height={14} width="90%" />
                    </Col>
                </Row>
            )),
        },
    ],
};
