/**
 * Zero Pilot (#1029 B8) — the pilot ten rendered from the NEW stack, end to
 * end: anatomies + behaviors from `@sigx/zero` (npm beta) through
 * `@sigx/lynx-zero`, CSS compiled by zero-kit's LYNX TARGET from the same
 * daisyUI recipe source the web uses (shipped by `@sigx/lynx-daisyui-zero`),
 * themes through zero's registry. Nothing on this screen is styled by the
 * legacy tailwind pipeline — every painted part answers to a `zx-*` class
 * the emitter produced.
 *
 * The probe card up top is the on-device half of the capabilities story:
 * each row paints ONLY if a specific selector shape resolved (part class,
 * state compound, axis compound), complementing the compile-time
 * capabilities-lint in zero-kit.
 */
import '@sigx/lynx-daisyui-zero/css/index.css';
// Side effect: seeds zero's theme registry with the daisy themes.
import '@sigx/lynx-daisyui-zero';
import type { Define } from '@sigx/lynx';
import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Accordion, Button, Col, Dialog, Popover, Progress, Row, ScrollView, Select, Slider,
    Switch, Tabs, Toast, ZeroRoot, createToaster, listThemes, themeController,
} from '@sigx/lynx-zero';

const toaster = createToaster();

type SectionProps =
    & Define.Prop<'title', string, true>
    & Define.Prop<'note', string, false>
    & Define.Slot<'default'>;

const Section = component<SectionProps>(({ props, slots }) => {
    return () => (
        <Col gap={10} style={{ paddingTop: '12px', paddingBottom: '12px' }}>
            <text style={{ fontSize: '15px', fontWeight: 'bold' }}>{props.title}</text>
            {props.note ? <text style={{ fontSize: '12px', opacity: 0.6 }}>{props.note}</text> : null}
            {slots.default?.()}
        </Col>
    );
});

export const ZeroPilot = component(() => {
    return () => (
        <ZeroRoot>
            <Screen title="Zero Pilot" />
            <ScrollView class="flex-fill">
                <Col gap={4} padding={16}>
                    <text style={{ fontSize: '12px', opacity: 0.6 }}>
                        Every part below is painted by class-grammar CSS compiled from
                        @sigx/zero-daisyui — the same recipes the web skin uses.
                    </text>

                    <Section
                        title="Theme (zero registry)"
                        note="Full-restatement zx-theme-* blocks; selection is one class swap."
                    >
                        <Row gap={8}>
                            {listThemes().map((theme) => (
                                <Button key={theme.name} size="sm" onPress={() => themeController.set(theme.name)}>
                                    <text>{theme.name}</text>
                                </Button>
                            ))}
                        </Row>
                    </Section>

                    <Section
                        title="Probe"
                        note="Each row paints only if its selector shape resolved: part class → axis compound → state compound."
                    >
                        <Row gap={8}>
                            <Button><text>part</text></Button>
                            <Button color="primary"><text>axis</text></Button>
                            <Switch defaultChecked label="state compound" />
                        </Row>
                    </Section>

                    <Section title="Button">
                        <Row gap={8}>
                            <Button color="primary"><text>Primary</text></Button>
                            <Button color="secondary"><text>Secondary</text></Button>
                            <Button color="accent" size="sm"><text>Accent sm</text></Button>
                            <Button disabled><text>Disabled</text></Button>
                        </Row>
                    </Section>

                    <Section title="Progress">
                        <Progress.Root value={65} color="primary">
                            <Progress.Track><Progress.Range /></Progress.Track>
                        </Progress.Root>
                        <Progress.Root value={null}>
                            <Progress.Track><Progress.Range /></Progress.Track>
                        </Progress.Root>
                    </Section>

                    <Section title="Switch">
                        <Row gap={16}>
                            <Switch defaultChecked color="primary">On</Switch>
                            <Switch>Off</Switch>
                            <Switch disabled>Disabled</Switch>
                        </Row>
                    </Section>

                    <Section title="Tabs">
                        <Tabs.Root defaultValue="one" color="primary">
                            <Tabs.List>
                                <Tabs.Tab value="one"><text>One</text></Tabs.Tab>
                                <Tabs.Tab value="two"><text>Two</text></Tabs.Tab>
                                <Tabs.Tab value="three"><text>Three</text></Tabs.Tab>
                            </Tabs.List>
                            <Tabs.Panel value="one"><text>First panel — tap-activated, unmounts when inactive.</text></Tabs.Panel>
                            <Tabs.Panel value="two"><text>Second panel.</text></Tabs.Panel>
                            <Tabs.Panel value="three"><text>Third panel.</text></Tabs.Panel>
                        </Tabs.Root>
                    </Section>

                    <Section title="Accordion">
                        <Accordion.Root defaultValue={['a']} collapsible>
                            <Accordion.Item value="a">
                                <Accordion.Trigger><text>What is this?</text></Accordion.Trigger>
                                <Accordion.Panel><text>Zero's accordion anatomy, closed panels unmounted.</text></Accordion.Panel>
                            </Accordion.Item>
                            <Accordion.Item value="b">
                                <Accordion.Trigger><text>And this?</text></Accordion.Trigger>
                                <Accordion.Panel><text>The same recipes as the web skin, emitted for lynx.</text></Accordion.Panel>
                            </Accordion.Item>
                        </Accordion.Root>
                    </Section>

                    <Section title="Dialog" note="Portals to ZeroRoot's outlet; backdrop is the ::backdrop pseudo part as a real view.">
                        <Dialog.Root color="primary">
                            <Dialog.Trigger><text>Open dialog</text></Dialog.Trigger>
                            <Dialog.Popup>
                                <Dialog.Title>Confirm</Dialog.Title>
                                <Dialog.Description>Backdrop tap dismisses through the layer stack.</Dialog.Description>
                                <Dialog.Footer>
                                    <Dialog.Close><text>Close</text></Dialog.Close>
                                </Dialog.Footer>
                            </Dialog.Popup>
                        </Dialog.Root>
                    </Section>

                    <Section title="Popover">
                        <Popover.Root placement="bottom-start">
                            <Popover.Trigger><text>Open popover</text></Popover.Trigger>
                            <Popover.Popup>
                                <Popover.Title>Anchored</Popover.Title>
                                <Popover.Close><text>×</text></Popover.Close>
                            </Popover.Popup>
                        </Popover.Root>
                    </Section>

                    <Section title="Select">
                        <Select.Root
                            placeholder="Pick a fruit"
                            label="Fruit"
                            color="primary"
                            options={[
                                { value: 'apple', label: 'Apple', group: 'Fruit' },
                                { value: 'banana', label: 'Banana', group: 'Fruit' },
                                { value: 'carrot', label: 'Carrot', group: 'Veg' },
                                { value: 'other', label: 'Other' },
                            ]}
                        />
                    </Section>

                    <Section title="Slider">
                        <Slider.Root
                            min={0}
                            max={100}
                            defaultValue={40}
                            marks={[0, 50, 100]}
                            label="Volume"
                            showValue
                            color="primary"
                        />
                    </Section>

                    <Section title="Toast">
                        <Button onPress={() => toaster.show({ title: 'Saved', description: 'From the zero toaster', duration: 3000 })}>
                            <text>Show toast</text>
                        </Button>
                    </Section>
                </Col>
            </ScrollView>
            <Toast.Viewport placement="top" toaster={toaster} />
        </ZeroRoot>
    );
});
