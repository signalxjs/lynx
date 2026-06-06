import { component } from '@sigx/lynx';
import { Center, Col, Row, Spacer, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Layout primitives — `Row`, `Col`, `Center` and `Spacer`, the flexbox
 * building blocks. Each takes numeric `gap` plus `align` / `justify`
 * (the raw flex values), so geometry is shown with small colored boxes.
 *
 * `Spacer` is the odd one out: with a numeric `size` it's a fixed gap;
 * with no props it sets `flex: 1` and pushes siblings apart.
 */
const box = (cls: string) => (
    <Center class={`${cls} rounded`} width={48} height={48}>
        <Text class="text-primary-content text-xs"> </Text>
    </Center>
);

export const layoutDemo: DaisyComponentDemo = {
    id: 'layout',
    title: 'Layout primitives',
    description: 'Row / Col / Center / Spacer — gap, align, justify and flex-fill',
    icon: { set: 'lucide', name: 'layout-grid' },
    sections: [
        {
            title: 'Row — gap & align',
            note: 'flexDirection: row; align="center" cross-aligns mixed heights',
            Demo: component(() => () => (
                <Row gap={12} align="center">
                    <Center class="bg-primary rounded" width={48} height={32} />
                    <Center class="bg-secondary rounded" width={48} height={64} />
                    <Center class="bg-primary rounded" width={48} height={48} />
                </Row>
            )),
        },
        {
            title: 'Col — gap',
            note: 'flexDirection: column with a numeric gap between children',
            Demo: component(() => () => (
                <Col gap={8}>
                    {box('bg-primary')}
                    {box('bg-secondary')}
                    {box('bg-primary')}
                </Col>
            )),
        },
        {
            title: 'Row — justify',
            note: 'justify="space-between" distributes children along the main axis',
            Demo: component(() => () => (
                <Col gap={12}>
                    <Row gap={0} justify="flex-start" class="bg-base-200 rounded" width={240} padding={6}>
                        {box('bg-primary')}
                        {box('bg-secondary')}
                    </Row>
                    <Row gap={0} justify="center" class="bg-base-200 rounded" width={240} padding={6}>
                        {box('bg-primary')}
                        {box('bg-secondary')}
                    </Row>
                    <Row gap={0} justify="space-between" class="bg-base-200 rounded" width={240} padding={6}>
                        {box('bg-primary')}
                        {box('bg-secondary')}
                    </Row>
                </Col>
            )),
        },
        {
            title: 'Center & Spacer',
            note: 'Center fills & centers; Spacer (no size) flex-fills to push siblings apart',
            Demo: component(() => () => (
                <Col gap={12}>
                    <Center class="bg-base-200 rounded" width={240} height={64}>
                        {box('bg-primary')}
                    </Center>
                    <Row class="bg-base-200 rounded" width={240} padding={6} align="center">
                        {box('bg-primary')}
                        <Spacer />
                        {box('bg-secondary')}
                    </Row>
                </Col>
            )),
        },
    ],
};
