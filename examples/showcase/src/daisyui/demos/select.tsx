import { component, signal } from '@sigx/lynx';
import { Col, Select, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

const roles = [
    { label: 'Design', value: 'design' },
    { label: 'Engineering', value: 'eng' },
    { label: 'Product', value: 'product' },
];

/**
 * Select — bordered/ghost variants, the color ramp, the size ramp, the
 * disabled state and a live `onChange`-bound dropdown echoing its value.
 */
export const selectDemo: DaisyComponentDemo = {
    id: 'select',
    title: 'Select',
    description: 'Bordered/ghost variants, color & size ramps, placeholder, disabled, live onChange binding',
    icon: { set: 'lucide', name: 'chevrons-up-down' },
    sections: [
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Select options={roles} placeholder="Default" />
                    <Select options={roles} placeholder="Bordered" variant="bordered" />
                    <Select options={roles} placeholder="Ghost" variant="ghost" />
                </Col>
            )),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Select options={roles} placeholder="Primary" variant="bordered" color="primary" />
                    <Select options={roles} placeholder="Success" variant="bordered" color="success" />
                    <Select options={roles} placeholder="Warning" variant="bordered" color="warning" />
                    <Select options={roles} placeholder="Error" variant="bordered" color="error" />
                </Col>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Select options={roles} placeholder="xs" variant="bordered" size="xs" />
                    <Select options={roles} placeholder="sm" variant="bordered" size="sm" />
                    <Select options={roles} placeholder="md" variant="bordered" size="md" />
                    <Select options={roles} placeholder="lg" variant="bordered" size="lg" />
                </Col>
            )),
        },
        {
            title: 'States',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Select options={roles} placeholder="Disabled" variant="bordered" disabled />
                </Col>
            )),
        },
        {
            title: 'Change events',
            Demo: component(() => {
                const role = signal('design');
                return () => (
                    <Col gap={8}>
                        <Select
                            options={roles}
                            variant="bordered"
                            value={role.value}
                            onChange={(value) => { role.value = value; }}
                        />
                        <Text class="opacity-60">selected: {role.value}</Text>
                    </Col>
                );
            }),
        },
    ],
};
