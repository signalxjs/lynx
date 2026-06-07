import { component } from '@sigx/lynx';
import { Col, Heading } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Heading — h1–h6 levels mapped onto the hero type ramp. */
export const headingDemo: HeroComponentDemo = {
    id: 'heading',
    title: 'Heading',
    description: 'h1–h6 levels on the hero type ramp',
    icon: { set: 'lucide', name: 'heading' },
    sections: [
        {
            title: 'Levels',
            Demo: component(() => () => (
                <Col gap={6}>
                    <Heading level={1}>Heading 1</Heading>
                    <Heading level={2}>Heading 2</Heading>
                    <Heading level={3}>Heading 3</Heading>
                    <Heading level={4}>Heading 4</Heading>
                    <Heading level={5}>Heading 5</Heading>
                    <Heading level={6}>Heading 6</Heading>
                </Col>
            )),
        },
    ],
};
