import { component, signal } from '@sigx/lynx';
import { Col, FormField, Input, Select, Text, Textarea } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

const roles = [
    { label: 'Design', value: 'design' },
    { label: 'Engineering', value: 'eng' },
    { label: 'Product', value: 'product' },
];

/**
 * FormField — a labelled wrapper around any control: plain label, the
 * `required` marker, the `error` message slot, and a live `model`-bound
 * field whose error toggles on validity.
 */
export const formfieldDemo: DaisyComponentDemo = {
    id: 'formfield',
    title: 'FormField',
    description: 'Labelled control wrapper with required marker, error message, wraps any input',
    icon: { set: 'lucide', name: 'rectangle-ellipsis' },
    sections: [
        {
            title: 'Label',
            Demo: component(() => () => (
                <FormField label="Full name">
                    <Input placeholder="Jane Doe" variant="bordered" />
                </FormField>
            )),
        },
        {
            title: 'Required',
            note: 'a trailing * is appended to the label',
            Demo: component(() => () => (
                <FormField label="Email" required>
                    <Input placeholder="jane@example.com" variant="bordered" type="text" />
                </FormField>
            )),
        },
        {
            title: 'Error',
            Demo: component(() => () => (
                <FormField label="Password" error="Must be at least 8 characters">
                    <Input placeholder="••••••••" variant="bordered" type="password" color="error" />
                </FormField>
            )),
        },
        {
            title: 'Wrapping any control',
            Demo: component(() => () => (
                <Col gap={12}>
                    <FormField label="Role">
                        <Select options={roles} placeholder="Pick one" variant="bordered" />
                    </FormField>
                    <FormField label="Bio">
                        <Textarea placeholder="A few words" variant="bordered" rows={3} />
                    </FormField>
                </Col>
            )),
        },
        {
            title: 'Live validation',
            Demo: component(() => {
                const name = signal('');
                return () => (
                    <Col gap={8}>
                        <FormField
                            label="Name"
                            required
                            error={name.value.length === 0 ? 'Name is required' : undefined}
                        >
                            <Input
                                placeholder="Type to clear the error"
                                variant="bordered"
                                color={name.value.length === 0 ? 'error' : 'success'}
                                model={() => name.value}
                            />
                        </FormField>
                        <Text class="opacity-60">value: {name.value || '—'}</Text>
                    </Col>
                );
            }),
        },
    ],
};
