import { component, signal } from '@sigx/lynx';
import { Col, Input, Row, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/**
 * Input — upstream HeroUI’s flat (filled) default vs bordered, the semantic
 * color accents, the sm–lg ramp, and a live model binding.
 */
export const inputDemo: HeroComponentDemo = {
    id: 'input',
    title: 'Input',
    description: 'Flat/bordered variants, color accents, sizes, model binding',
    icon: { set: 'lucide', name: 'text-cursor-input' },
    sections: [
        {
            title: 'Variants',
            note: 'flat (filled surface) is the hero default; bordered opts into an outline',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Input placeholder="Flat (default)" />
                    <Input placeholder="Bordered" variant="bordered" />
                </Col>
            )),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Input placeholder="Primary" color="primary" variant="bordered" />
                    <Input placeholder="Success" color="success" variant="bordered" />
                    <Input placeholder="Error" color="error" variant="bordered" />
                </Col>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Input placeholder="sm" size="sm" />
                    <Input placeholder="md (default)" />
                    <Input placeholder="lg" size="lg" />
                </Col>
            )),
        },
        {
            title: 'States & types',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Input placeholder="Disabled" disabled />
                    <Input placeholder="Password" type="password" />
                    <Input placeholder="Number" type="number" />
                </Col>
            )),
        },
        {
            title: 'Model binding',
            Demo: component(() => {
                const name = signal('');
                return () => (
                    <Col gap={8}>
                        <Input placeholder="Type your name…" model={() => name.value} />
                        <Row gap={4}>
                            <Text size="sm" class="opacity-60">value:</Text>
                            <Text size="sm" weight="semibold">{name.value || '(empty)'}</Text>
                        </Row>
                    </Col>
                );
            }),
        },
    ],
};
