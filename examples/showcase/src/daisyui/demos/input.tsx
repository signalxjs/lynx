import { component, signal } from '@sigx/lynx';
import { Col, Input, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Input — bordered/ghost variants, the color ramp, the size ramp, types and
 * the disabled state, plus a live `model`-bound field that echoes its value.
 */
export const inputDemo: DaisyComponentDemo = {
    id: 'input',
    title: 'Input',
    description: 'Bordered/ghost variants, color & size ramps, types, disabled, live model binding',
    icon: { set: 'lucide', name: 'text-cursor-input' },
    sections: [
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Input placeholder="Default" />
                    <Input placeholder="Bordered" variant="bordered" />
                    <Input placeholder="Ghost" variant="ghost" />
                </Col>
            )),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Input placeholder="Primary" variant="bordered" color="primary" />
                    <Input placeholder="Secondary" variant="bordered" color="secondary" />
                    <Input placeholder="Accent" variant="bordered" color="accent" />
                    <Input placeholder="Info" variant="bordered" color="info" />
                    <Input placeholder="Success" variant="bordered" color="success" />
                    <Input placeholder="Warning" variant="bordered" color="warning" />
                    <Input placeholder="Error" variant="bordered" color="error" />
                </Col>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Input placeholder="xs" variant="bordered" size="xs" />
                    <Input placeholder="sm" variant="bordered" size="sm" />
                    <Input placeholder="md" variant="bordered" size="md" />
                    <Input placeholder="lg" variant="bordered" size="lg" />
                </Col>
            )),
        },
        {
            title: 'Types & states',
            note: 'text / number / password and disabled',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Input placeholder="Number" variant="bordered" type="number" />
                    <Input placeholder="Password" variant="bordered" type="password" />
                    <Input placeholder="Disabled" variant="bordered" disabled />
                </Col>
            )),
        },
        {
            title: 'Model binding',
            Demo: component(() => {
                // Seeded with a value so the field is prefilled on first render —
                // editing/restoring through `model` alone, not just typing (#404).
                const text = signal('Ada Lovelace');
                return () => (
                    <Col gap={8}>
                        <Input
                            placeholder="Type here"
                            variant="bordered"
                            model={() => text.value}
                        />
                        <Text class="opacity-60">value: {text.value || '—'}</Text>
                    </Col>
                );
            }),
        },
    ],
};
