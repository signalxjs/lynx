import { component, signal } from '@sigx/lynx';
import { Card, Col, Tabs, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Tabs — the standalone daisy `Tabs` compound (`Tabs` + `Tabs.Tab`) for
 * generic, non-navigation tab UI. Each `Tabs.Tab` takes a `value` and a
 * `label` (or slot children) and reports presses via `onPress`; the parent
 * marks the selected tab with `active`.
 *
 * Unlike `NavTabBar`, `Tabs` owns no state — the consumer drives the active
 * tab. The last section wires a signal so switching a tab swaps the panel
 * below it.
 */
export const tabsDemo: DaisyComponentDemo = {
    id: 'tabs',
    title: 'Tabs',
    description: 'Standalone tab strip — labels, active state and signal-driven content switching',
    icon: { set: 'lucide', name: 'folder-tree' },
    sections: [
        {
            title: 'Basic',
            note: 'static labels — the middle tab marked active',
            Demo: component(() => () => (
                <Tabs>
                    <Tabs.Tab value="overview" label="Overview" />
                    <Tabs.Tab value="activity" label="Activity" active />
                    <Tabs.Tab value="settings" label="Settings" />
                </Tabs>
            )),
        },
        {
            title: 'Slot content',
            note: 'a tab can render arbitrary children instead of `label`',
            Demo: component(() => () => (
                <Tabs>
                    <Tabs.Tab value="all"><Text>All</Text></Tabs.Tab>
                    <Tabs.Tab value="unread" active><Text class="font-semibold">Unread</Text></Tabs.Tab>
                    <Tabs.Tab value="archived"><Text>Archived</Text></Tabs.Tab>
                </Tabs>
            )),
        },
        {
            title: 'Live selection',
            note: 'a signal tracks the active tab and swaps the panel below',
            Demo: component(() => {
                const active = signal('overview');
                const panels: Record<string, string> = {
                    overview: 'A high-level summary of the workspace.',
                    activity: 'Recent events, sorted newest first.',
                    settings: 'Preferences for this workspace.',
                };
                return () => (
                    <Col gap={12}>
                        <Tabs>
                            <Tabs.Tab
                                value="overview"
                                label="Overview"
                                active={active.value === 'overview'}
                                onPress={() => { active.value = 'overview'; }}
                            />
                            <Tabs.Tab
                                value="activity"
                                label="Activity"
                                active={active.value === 'activity'}
                                onPress={() => { active.value = 'activity'; }}
                            />
                            <Tabs.Tab
                                value="settings"
                                label="Settings"
                                active={active.value === 'settings'}
                                onPress={() => { active.value = 'settings'; }}
                            />
                        </Tabs>
                        <Card bordered class="w-72">
                            <Card.Body>
                                <Text class="opacity-70">{panels[active.value]}</Text>
                            </Card.Body>
                        </Card>
                    </Col>
                );
            }),
        },
    ],
};
