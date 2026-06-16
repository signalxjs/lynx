import { component, signal } from '@sigx/lynx';
import { Collapse, Col, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Collapse — single disclosure (default-open + arrow/plus indicators), a live
 * `model`-bound section, and a `Collapse.Group` accordion where only one item
 * is open at a time (two-way `model` of the open item's value).
 */
export const collapseDemo: DaisyComponentDemo = {
    id: 'collapse',
    title: 'Collapse',
    description: 'Disclosure + accordion — arrow/plus indicators, live model open state, mutually-exclusive group',
    icon: { set: 'lucide', name: 'chevrons-down-up' },
    sections: [
        {
            title: 'Default open',
            Demo: component(() => () => (
                <Collapse title="What is Lynx?" defaultOpen>
                    <Text>Lynx is a dual-thread mobile runtime. This panel starts expanded.</Text>
                </Collapse>
            )),
        },
        {
            title: 'Indicators',
            note: 'arrow (default) and plus/minus',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Collapse title="Arrow indicator" icon="arrow">
                        <Text>Tap the header to toggle.</Text>
                    </Collapse>
                    <Collapse title="Plus indicator" icon="plus">
                        <Text>Tap the header to toggle.</Text>
                    </Collapse>
                </Col>
            )),
        },
        {
            title: 'Model binding',
            Demo: component(() => {
                const open = signal(false);
                return () => (
                    <Col gap={8}>
                        <Collapse title="Bound section" model={() => open.value}>
                            <Text>This section's open state is a signal.</Text>
                        </Collapse>
                        <Text class="opacity-60">open: {open.value ? 'yes' : 'no'}</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Accordion group',
            note: 'only one open at a time',
            Demo: component(() => {
                const openItem = signal<string | undefined>('shipping');
                return () => (
                    <Col gap={8}>
                        <Collapse.Group model={() => openItem.value}>
                            <Collapse value="shipping" title="Shipping">
                                <Text>Ships in 2–3 business days.</Text>
                            </Collapse>
                            <Collapse value="returns" title="Returns">
                                <Text>30-day return window.</Text>
                            </Collapse>
                            <Collapse value="warranty" title="Warranty">
                                <Text>One-year limited warranty.</Text>
                            </Collapse>
                        </Collapse.Group>
                        <Text class="opacity-60">open: {openItem.value || '—'}</Text>
                    </Col>
                );
            }),
        },
    ],
};
