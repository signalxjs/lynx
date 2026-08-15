/**
 * Zero Parity (#1029 B8) — the same daisyUI look from two stacks, side by
 * side on one device:
 *
 *   LEFT  — NEW: zero anatomy + class-grammar CSS compiled from
 *           @sigx/zero-daisyui's recipes (the web's recipe source).
 *   RIGHT — OLD: @sigx/lynx-daisyui's hand-written components + tailwind
 *           preset CSS (on @sigx/lynx-zero-legacy).
 *
 * The two columns should read as the same design system; every visible
 * divergence is a recipe-fidelity bug to file against the zero-daisyui
 * lynx target. This screen (and the old components) retire together with
 * the legacy stack once parity holds.
 */
// Both the CSS and the registry seeding, imported here rather than leaning on
// ZeroPilot's copy: relying on `routes.ts` importing the other screen eagerly
// makes this screen render unstyled the day routes go lazy.
import '@sigx/lynx-daisyui-zero/css/index.css';
import '@sigx/lynx-daisyui-zero';
import type { Define } from '@sigx/lynx';
import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button as OldButton, Collapse as OldCollapse, Progress as OldProgress, Range as OldRange,
    Modal as OldModal, Select as OldSelect, Tabs as OldTabs, Text, Toggle as OldToggle,
} from '@sigx/lynx-daisyui';
import {
    Accordion, Button, Col, Dialog, Popover, Progress, Row, ScrollView, Select, Slider,
    Switch, Tabs, Toast, ZeroRoot, createToaster,
} from '@sigx/lynx-zero';

const toaster = createToaster();

type PairProps = Define.Prop<'label', string, true> & Define.Slot<'zero'> & Define.Slot<'legacy'>;

const Pair = component<PairProps>(({ props, slots }) => {
    return () => (
        <Col gap={6} style={{ paddingTop: '10px', paddingBottom: '10px' }}>
            <text style={{ fontSize: '13px', fontWeight: 'bold' }}>{props.label}</text>
            <Row gap={12}>
                <view style={{ flexGrow: 1, flexShrink: 1, flexBasis: '0%' }}>{slots.zero?.()}</view>
                <view style={{ flexGrow: 1, flexShrink: 1, flexBasis: '0%' }}>{slots.legacy?.()}</view>
            </Row>
        </Col>
    );
});

export const ZeroParity = component(() => {
    // Model-bound so the OLD toggle actually toggles — a `checked`-only
    // Toggle is read-only, which would make the behavior comparison lie.
    const oldChecked = signal<boolean>(true);
    const oldTab = signal<string>('one');
    const oldModal = signal<boolean>(false);
    return () => (
        <ZeroRoot>
            <Screen title="Zero Parity" />
            <ScrollView flex={1}>
                <Col gap={4} padding={16}>
                    <Row gap={12}>
                        <text style={{ flexGrow: 1, fontSize: '12px', opacity: 0.6 }}>NEW — compiled recipes</text>
                        <text style={{ flexGrow: 1, fontSize: '12px', opacity: 0.6 }}>OLD — hand-written CSS</text>
                    </Row>

                    <Pair
                        label="Button / primary"
                        slots={{
                            zero: () => <Button color="primary"><text>Save</text></Button>,
                            legacy: () => <OldButton color="primary">Save</OldButton>,
                        }}
                    />

                    <Pair
                        label="Button / default"
                        slots={{
                            zero: () => <Button><text>Cancel</text></Button>,
                            legacy: () => <OldButton>Cancel</OldButton>,
                        }}
                    />

                    <Pair
                        label="Switch vs Toggle / checked"
                        slots={{
                            // The default slot is the VISIBLE label; `label` is
                            // the a11y name only and renders nothing.
                            zero: () => <Switch defaultChecked color="primary">Wi-Fi</Switch>,
                            legacy: () => <OldToggle model={() => oldChecked.value} color="primary" />,
                        }}
                    />

                    <Pair
                        label="Progress / 60%"
                        slots={{
                            zero: () => (
                                <Progress.Root value={60} color="primary">
                                    <Progress.Track><Progress.Range /></Progress.Track>
                                </Progress.Root>
                            ),
                            legacy: () => <OldProgress value={60} max={100} color="primary" />,
                        }}
                    />

                    <Pair
                        label="Tabs"
                        slots={{
                            zero: () => (
                                <Tabs.Root defaultValue="one" color="primary">
                                    <Tabs.List>
                                        <Tabs.Tab value="one"><text>One</text></Tabs.Tab>
                                        <Tabs.Tab value="two"><text>Two</text></Tabs.Tab>
                                    </Tabs.List>
                                </Tabs.Root>
                            ),
                            legacy: () => (
                                <OldTabs activeTab={oldTab.value} onChange={(v) => { oldTab.value = v; }}>
                                    <OldTabs.Tab value="one" label="One" />
                                    <OldTabs.Tab value="two" label="Two" />
                                </OldTabs>
                            ),
                        }}
                    />

                    <Pair
                        label="Accordion vs Collapse"
                        slots={{
                            zero: () => (
                                <Accordion.Root defaultValue={['a']} collapsible>
                                    <Accordion.Item value="a">
                                        <Accordion.Trigger><text>Details</text></Accordion.Trigger>
                                        <Accordion.Panel><text>Open by default.</text></Accordion.Panel>
                                    </Accordion.Item>
                                </Accordion.Root>
                            ),
                            legacy: () => (
                                <OldCollapse title="Details" defaultOpen>
                                    <Text>Open by default.</Text>
                                </OldCollapse>
                            ),
                        }}
                    />

                    <Pair
                        label="Dialog vs Modal / trigger"
                        slots={{
                            zero: () => (
                                <Dialog.Root color="primary">
                                    <Dialog.Trigger><text>Open</text></Dialog.Trigger>
                                    <Dialog.Popup>
                                        <Dialog.Title>Confirm</Dialog.Title>
                                        <Dialog.Footer><Dialog.Close><text>Close</text></Dialog.Close></Dialog.Footer>
                                    </Dialog.Popup>
                                </Dialog.Root>
                            ),
                            legacy: () => (
                                <>
                                    <OldButton color="primary" onPress={() => { oldModal.value = true; }}>Open</OldButton>
                                    <OldModal open={oldModal.value} onClose={() => { oldModal.value = false; }}>
                                        <OldModal.Header><Text>Confirm</Text></OldModal.Header>
                                        <OldModal.Actions>
                                            <OldButton onPress={() => { oldModal.value = false; }}>Close</OldButton>
                                        </OldModal.Actions>
                                    </OldModal>
                                </>
                            ),
                        }}
                    />

                    <Pair
                        label="Select"
                        slots={{
                            zero: () => (
                                <Select.Root
                                    placeholder="Pick"
                                    color="primary"
                                    options={[
                                        { value: 'a', label: 'Apple' },
                                        { value: 'b', label: 'Banana' },
                                    ]}
                                />
                            ),
                            legacy: () => (
                                <OldSelect
                                    placeholder="Pick"
                                    color="primary"
                                    options={[
                                        { value: 'a', label: 'Apple' },
                                        { value: 'b', label: 'Banana' },
                                    ]}
                                />
                            ),
                        }}
                    />

                    <Pair
                        label="Slider vs Range / 40"
                        slots={{
                            zero: () => <Slider.Root min={0} max={100} defaultValue={40} color="primary" />,
                            legacy: () => <OldRange value={40} min={0} max={100} color="primary" />,
                        }}
                    />

                    {/* The last two of the pilot ten have no counterpart in the
                        old package at all, so they render NEW-only rather than
                        being left off the screen — "no old column" is itself
                        part of what the new stack is buying. */}
                    <Pair
                        label="Popover · new stack only"
                        slots={{
                            zero: () => (
                                <Popover.Root placement="bottom-start">
                                    <Popover.Trigger><text>Open</text></Popover.Trigger>
                                    <Popover.Popup>
                                        <Popover.Title>Anchored</Popover.Title>
                                        <Popover.Close><text>×</text></Popover.Close>
                                    </Popover.Popup>
                                </Popover.Root>
                            ),
                            legacy: () => <text style={{ fontSize: '12px', opacity: 0.5 }}>— no counterpart</text>,
                        }}
                    />

                    <Pair
                        label="Toast · new stack only"
                        slots={{
                            zero: () => (
                                <Button onPress={() => toaster.show({ title: 'Saved', duration: 2000 })}>
                                    <text>Show toast</text>
                                </Button>
                            ),
                            legacy: () => <text style={{ fontSize: '12px', opacity: 0.5 }}>— no counterpart</text>,
                        }}
                    />
                </Col>
            </ScrollView>
            <Toast.Viewport placement="top" toaster={toaster} />
        </ZeroRoot>
    );
});
