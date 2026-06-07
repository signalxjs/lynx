import { component } from '@sigx/lynx';
import { Col, Progress } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Progress — track + colored fill. */
export const progressDemo: HeroComponentDemo = {
    id: 'progress',
    title: 'Progress',
    description: 'Track + colored fill, value/max',
    icon: { set: 'lucide', name: 'loader-pinwheel' },
    sections: [
        {
            title: 'Values',
            Demo: component(() => () => (
                <Col gap={10}>
                    <Progress value={25} />
                    <Progress value={50} color="success" />
                    <Progress value={80} color="warning" />
                    <Progress value={100} color="error" />
                </Col>
            )),
        },
    ],
};
