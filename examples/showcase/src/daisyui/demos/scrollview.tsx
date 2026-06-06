import { component } from '@sigx/lynx';
import { Center, Col, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * ScrollView — a scrollable region wrapping a native `<scroll-view>`.
 * `direction` selects vertical (default) or horizontal scrolling; give it
 * a fixed `height` / `width` so the content actually overflows and scrolls.
 */
const rows = Array.from({ length: 20 }, (_, i) => i + 1);

export const scrollviewDemo: DaisyComponentDemo = {
    id: 'scrollview',
    title: 'ScrollView',
    description: 'Vertical & horizontal scrolling regions over a fixed viewport',
    icon: { set: 'lucide', name: 'scroll' },
    sections: [
        {
            title: 'Vertical',
            note: '20 rows in a fixed h-48 viewport — scrolls on the Y axis',
            Demo: component(() => () => (
                <ScrollView class="h-48 w-64 bg-base-200 rounded" showScrollbar>
                    <Col gap={8} padding={12}>
                        {rows.map((n) => (
                            <Center key={n} class="bg-primary rounded" height={40}>
                                <Text class="text-primary-content">Row {n}</Text>
                            </Center>
                        ))}
                    </Col>
                </ScrollView>
            )),
        },
        {
            title: 'Horizontal',
            note: 'direction="horizontal" scrolls on the X axis',
            Demo: component(() => () => (
                <ScrollView direction="horizontal" class="w-64 bg-base-200 rounded" showScrollbar>
                    <Row gap={8} padding={12}>
                        {rows.map((n) => (
                            <Center key={n} class="bg-secondary rounded" width={64} height={64}>
                                <Text class="text-secondary-content">{n}</Text>
                            </Center>
                        ))}
                    </Row>
                </ScrollView>
            )),
        },
    ],
};
