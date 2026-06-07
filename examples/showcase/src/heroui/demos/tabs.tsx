import { component, signal } from '@sigx/lynx';
import { Col, Tabs, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/**
 * Tabs — container-driven selection from the shared headless TabsSelection
 * (`activeTab` + `onChange`); per-tab `active`/`onPress` overrides still win.
 */
export const tabsDemo: HeroComponentDemo = {
    id: 'tabs',
    title: 'Tabs',
    description: 'Headless container-driven selection — activeTab/onChange',
    icon: { set: 'lucide', name: 'folder-tree' },
    sections: [
        {
            title: 'Container-driven',
            note: 'Selection state lives in the container; tabs derive active from `value`',
            Demo: component(() => {
                const tab = signal('photos');
                return () => (
                    <Col gap={8}>
                        <Tabs activeTab={tab.value} onChange={(v) => { tab.value = v; }}>
                            <Tabs.Tab value="photos" label="Photos" />
                            <Tabs.Tab value="music" label="Music" />
                            <Tabs.Tab value="videos" label="Videos" />
                        </Tabs>
                        <Text size="sm" class="opacity-60">active tab: {tab.value}</Text>
                    </Col>
                );
            }),
        },
        {
            title: 'Tab content panes',
            Demo: component(() => {
                const tab = signal('a');
                return () => (
                    <Col gap={8}>
                        <Tabs activeTab={tab.value} onChange={(v) => { tab.value = v; }}>
                            <Tabs.Tab value="a" label="Alpha" />
                            <Tabs.Tab value="b" label="Beta" />
                        </Tabs>
                        {tab.value === 'a'
                            ? <Text size="sm">Alpha pane — mounted only while selected.</Text>
                            : <Text size="sm">Beta pane — swapped in by the signal.</Text>}
                    </Col>
                );
            }),
        },
    ],
};
