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
            Demo: component(() => {
                const picked = signal('email');
                return () => (
                    <Col gap={8}>
                        <Radio>
                            <Radio.Item value="email" label="Email" color="primary" checked={picked.value === 'email'} onSelect={(v) => { picked.value = v; }} />
                            <Radio.Item value="sms" label="SMS" color="primary" checked={picked.value === 'sms'} onSelect={(v) => { picked.value = v; }} />
                            <Radio.Item value="push" label="Push" color="primary" checked={picked.value === 'push'} onSelect={(v) => { picked.value = v; }} />
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
