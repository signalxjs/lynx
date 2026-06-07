import { component, signal } from '@sigx/lynx';
import { Col, FormField, Input } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** FormField — label + control + error wrapper. */
export const formfieldDemo: HeroComponentDemo = {
    id: 'formfield',
    title: 'FormField',
    description: 'Label, required marker, and error line around a control',
    icon: { set: 'lucide', name: 'rectangle-ellipsis' },
    sections: [
        {
            title: 'Label & required',
            Demo: component(() => {
                const email = signal('');
                return () => (
                    <Col gap={12}>
                        <FormField label="Display name">
                            <Input placeholder="Ada Lovelace" variant="bordered" />
                        </FormField>
                        <FormField label="Email" required>
                            <Input placeholder="you@example.com" variant="bordered" model={() => email.value} />
                        </FormField>
                    </Col>
                );
            }),
        },
        {
            title: 'Error state',
            Demo: component(() => () => (
                <FormField label="Password" required error="Must be at least 8 characters">
                    <Input placeholder="••••••" type="password" variant="bordered" color="error" />
                </FormField>
            )),
        },
    ],
};
