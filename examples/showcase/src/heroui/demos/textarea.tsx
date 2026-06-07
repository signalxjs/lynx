import { component, signal } from '@sigx/lynx';
import { Col, Textarea, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Textarea — flat/bordered multiline, color accents, sizes, model binding. */
export const textareaDemo: HeroComponentDemo = {
    id: 'textarea',
    title: 'Textarea',
    description: 'Multiline flat/bordered, color accents, rows, model binding',
    icon: { set: 'lucide', name: 'text' },
    sections: [
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Textarea placeholder="Flat (default)" rows={3} />
                    <Textarea placeholder="Bordered" variant="bordered" rows={3} />
                </Col>
            )),
        },
        {
            title: 'Sizes & rows',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Textarea placeholder="sm, 2 rows" size="sm" rows={2} />
                    <Textarea placeholder="lg, 4 rows" size="lg" rows={4} />
                </Col>
            )),
        },
        {
            title: 'Model binding',
            Demo: component(() => {
                const note = signal('');
                return () => (
                    <Col gap={8}>
                        <Textarea placeholder="Write a note…" variant="bordered" model={() => note.value} />
                        <Text size="sm" class="opacity-60">{note.value.length} chars</Text>
                    </Col>
                );
            }),
        },
    ],
};
