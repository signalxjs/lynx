import { component } from '@sigx/lynx';
import { Loading, Row } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Loading — spinner; size + color. */
export const loadingDemo: HeroComponentDemo = {
    id: 'loading',
    title: 'Loading',
    description: 'Spinner — size ramp and semantic color',
    icon: { set: 'lucide', name: 'loader' },
    sections: [
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={16} align="center">
                    <Loading size="sm" />
                    <Loading size="md" />
                    <Loading size="lg" />
                </Row>
            )),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Row gap={16} align="center">
                    <Loading color="primary" />
                    <Loading color="success" />
                    <Loading color="error" />
                </Row>
            )),
        },
    ],
};
