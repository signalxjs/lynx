import { component, signal } from '@sigx/lynx';
import { Col, Text, Textarea } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Textarea — bordered/ghost variants, the color ramp, the size ramp, the
 * disabled state and a live `model`-bound field echoing its value.
 */
export const textareaDemo: DaisyComponentDemo = {
    id: 'textarea',
    title: 'Textarea',
    description: 'Bordered/ghost variants, color & size ramps, rows, disabled, live model binding',
    icon: { set: 'lucide', name: 'text' },
    sections: [
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Textarea placeholder="Default" rows={2} />
                    <Textarea placeholder="Bordered" variant="bordered" rows={2} />
                    <Textarea placeholder="Ghost" variant="ghost" rows={2} />
                </Col>
            )),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Textarea placeholder="Primary" variant="bordered" color="primary" rows={2} />
                    <Textarea placeholder="Success" variant="bordered" color="success" rows={2} />
                    <Textarea placeholder="Warning" variant="bordered" color="warning" rows={2} />
                    <Textarea placeholder="Error" variant="bordered" color="error" rows={2} />
                </Col>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Textarea placeholder="xs" variant="bordered" size="xs" rows={2} />
                    <Textarea placeholder="sm" variant="bordered" size="sm" rows={2} />
                    <Textarea placeholder="md" variant="bordered" size="md" rows={2} />
                    <Textarea placeholder="lg" variant="bordered" size="lg" rows={2} />
                </Col>
            )),
        },
        {
            title: 'States',
            note: 'rows controls height; disabled',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Textarea placeholder="5 rows" variant="bordered" rows={5} />
                    <Textarea placeholder="Disabled" variant="bordered" rows={2} disabled />
                </Col>
            )),
        },
        {
            title: 'Model binding',
            Demo: component(() => {
                const bio = signal('');
                return () => (
                    <Col gap={8}>
                        <Textarea
                            placeholder="Short bio"
                            variant="bordered"
                            rows={3}
                            model={() => bio.value}
                        />
                        <Text class="opacity-60">{bio.value.length} chars</Text>
                    </Col>
                );
            }),
        },
    ],
};
