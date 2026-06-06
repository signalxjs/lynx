import { component } from '@sigx/lynx';
import { Col, Row, Skeleton } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Skeleton — sized blocks, a circle avatar placeholder and a composed
 * card-loading layout.
 *
 * Skeleton is a static placeholder; it has no interactive state.
 */
export const skeletonDemo: DaisyComponentDemo = {
    id: 'skeleton',
    title: 'Skeleton',
    description: 'Sized blocks, circle avatars and composed loading layouts',
    icon: { set: 'lucide', name: 'layout-template' },
    sections: [
        {
            title: 'Blocks',
            note: 'width / height control the placeholder size',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Skeleton width={200} height={16} />
                    <Skeleton width={160} height={16} />
                    <Skeleton width={120} height={16} />
                </Col>
            )),
        },
        {
            title: 'Circle',
            note: 'circle avatar placeholders',
            Demo: component(() => () => (
                <Row gap={12} align="center">
                    <Skeleton circle width={32} />
                    <Skeleton circle width={48} />
                    <Skeleton circle width={64} />
                </Row>
            )),
        },
        {
            title: 'Card loading',
            note: 'avatar + lines composing a loading card',
            Demo: component(() => () => (
                <Row gap={12} align="center">
                    <Skeleton circle width={48} />
                    <Col gap={8}>
                        <Skeleton width={180} height={14} />
                        <Skeleton width={120} height={14} />
                    </Col>
                </Row>
            )),
        },
    ],
};
