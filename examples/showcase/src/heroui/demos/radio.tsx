import { component, signal } from '@sigx/lynx';
import { Col, Radio, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Radio — ring + dot; group with single-selection. */
export const radioDemo: HeroComponentDemo = {
    id: 'radio',
    title: 'Radio',
    description: 'Ring + dot, single-selection group',
    icon: { set: 'lucide', name: 'circle-dot' },
    sections: [
        {
            title: 'Interactive group',
            note: 'Group-driven: `model` on Radio, items inherit color',
            Demo: component(() => {
                const picked = signal('email');
                return () => (
                    <Col gap={8}>
                        <Radio model={() => picked.value} color="primary">
                            <Radio.Item value="email" label="Email" />
                            <Radio.Item value="sms" label="SMS" />
                            <Radio.Item value="push" label="Push" />
                        </Radio>
                        <Text size="sm" class="opacity-60">selected: {picked.value}</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Colors & sizes',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Radio>
                        <Radio.Item value="a" label="Primary" color="primary" checked />
                        <Radio.Item value="b" label="Success" color="success" checked />
                        <Radio.Item value="c" label="Large" color="primary" size="lg" checked />
                    </Radio>
                </Col>
            )),
        },
    ],
};
