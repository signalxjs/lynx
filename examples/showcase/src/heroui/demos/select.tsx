import { component, signal } from '@sigx/lynx';
import { Col, Select, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

const FRUITS = [
    { label: 'Apple', value: 'apple' },
    { label: 'Banana', value: 'banana' },
    { label: 'Cherry', value: 'cherry' },
];

/** Select — dropdown overlay; flat/bordered, color, sizes. */
export const selectDemo: HeroComponentDemo = {
    id: 'select',
    title: 'Select',
    description: 'Dropdown overlay — flat/bordered, color accents, sizes',
    icon: { set: 'lucide', name: 'chevron-down' },
    sections: [
        {
            title: 'Interactive',
            Demo: component(() => {
                const fruit = signal('');
                return () => (
                    <Col gap={8}>
                        <Select
                            options={FRUITS}
                            value={fruit.value}
                            placeholder="Pick a fruit…"
                            onChange={(v) => { fruit.value = v; }}
                        />
                        <Text size="sm" class="opacity-60">selected: {fruit.value || '(none)'}</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Variants & sizes',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Select options={FRUITS} value="apple" />
                    <Select options={FRUITS} value="apple" variant="bordered" color="primary" />
                    <Select options={FRUITS} value="apple" size="sm" />
                    <Select options={FRUITS} value="apple" size="lg" />
                    <Select options={FRUITS} placeholder="Disabled" disabled />
                </Col>
            )),
        },
    ],
};
