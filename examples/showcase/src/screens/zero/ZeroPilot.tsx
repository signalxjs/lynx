/**
 * Zero Pilot (#1029 B8) — the pilot ten rendered from the NEW stack, end to
 * end: anatomies + behaviors from `@sigx/zero` (npm beta) through
 * `@sigx/lynx-zero`, CSS compiled by zero-kit's LYNX TARGET from the same
 * daisyUI recipe source the web uses (shipped by `@sigx/lynx-daisyui-zero`),
 * themes through zero's registry. Nothing on this screen is styled by the
 * legacy tailwind pipeline — every painted part answers to a `zx-*` class
 * the emitter produced, and the screen's own chrome is `zero-probe.css`.
 *
 * The probe card up top is the on-device half of the capabilities story: a
 * bar per construct, each one a verdict you can read off a screenshot (see
 * `zero-probe.css` for how to read it). It complements zero-kit's
 * compile-time capabilities lint — and its last three bars are aimed at the
 * dropped-declaration bug the compile-time side does NOT catch (#1029).
 */
import '@sigx/lynx-daisyui-zero/css/index.css';
// Side effect: seeds zero's theme registry with the daisy themes.
import '@sigx/lynx-daisyui-zero';
import './zero-probe.css';
import type { Define } from '@sigx/lynx';
import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Accordion, Button, Col, Dialog, Popover, Progress, Row, ScrollView, Select, Slider,
    Switch, Tabs, Toast, ZeroRoot, createToaster, listThemes, themeController,
} from '@sigx/lynx-zero';

const toaster = createToaster();

type ProbeBarProps =
    /** The classes under test, appended after the pink `zxp-bar` base. */
    & Define.Prop<'probe', string, true>
    & Define.Prop<'label', string, true>;

/** One verdict bar. Reading rules live in `zero-probe.css`. */
const ProbeBar = component<ProbeBarProps>(({ props }) => {
    return () => (
        <view class={`zxp-bar ${props.probe}`}>
            <text class="zxp-bar-label">{props.label}</text>
        </view>
    );
});

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
            <ScrollView flex={1}>
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
                        title="Probe · selector shapes"
                        note="Green = the engine resolved this shape of the class grammar. Pink = it did not."
                    >
                        <Col gap={6}>
                            <ProbeBar probe="zx-zxprobe__bar" label="part class · .zx-scope__part" />
                            <ProbeBar
                                probe="zx-zxprobe__axis zx-a-color-primary"
                                label="axis compound · .zx-scope__part.zx-a-color-primary"
                            />
                            <ProbeBar
                                probe="zx-zxprobe__state zx-s-checked"
                                label="state compound · .zx-scope__part.zx-s-checked"
                            />
                            <ProbeBar
                                probe="zx-zxprobe__flag zx-f-pressed"
                                label="flag compound · .zx-scope__part.zx-f-pressed"
                            />
                            <ProbeBar
                                probe="zx-zxprobe__descendant"
                                label="descendant from host · .zx-root .zx-scope__part"
                            />
                        </Col>
                    </Section>

                    <Section
                        title="Probe · skin & token indirection"
                        note="Daisy indigo = the lookup resolved. Pink = it did not. The last bar reads --btn-ink from a NON-button element: the emitter defines it on button parts only, so an unpainted bar here is correct, and it is what an unresolvable var() looks like on lynx — no fallback, nothing painted."
                    >
                        <Col gap={6}>
                            <ProbeBar probe="zxp-token" label="skin token · var(--color-primary)" />
                            <ProbeBar probe="zxp-chain" label="var → var chain · how every solid button paints" />
                            <ProbeBar probe="zxp-rem" label="rem control · 10rem, resolved = 160px wide" />
                            <ProbeBar probe="zxp-calc" label="calc(var(--radius-box) * 20) · resolved = 160px wide" />
                            <ProbeBar probe="zxp-dangling" label="out-of-scope var(--btn-ink) · expected unpainted" />
                        </Col>
                    </Section>

                    <Section
                        title="Probe · the switch's own constructs"
                        note="daisy's switch control uses all of these at once. Its CSS is now complete and it still does not render, so these split which one lynx does not do. Every var here carries a fallback, so a full-bleed bar means the CONSTRUCT failed, not a missing token."
                    >
                        <Col gap={6}>
                            <ProbeBar probe="zxp-calc-nested" label="nested calc, two vars · resolved = 128px" />
                            <ProbeBar probe="zxp-min" label="min(var, var) · resolved = 160px" />
                            <ProbeBar probe="zxp-min-in-calc" label="min() inside calc() · resolved = 160px" />
                            <view class="zxp-grid">
                                <view class="zxp-grid-cell" />
                                <view class="zxp-grid-cell" />
                                <view class="zxp-grid-cell" />
                            </view>
                            <text style={{ fontSize: '12px' }}>↑ inline-grid, 1fr 1fr 1fr · resolved = three bands side by side</text>
                            <view class="zxp-aspect" />
                            <text style={{ fontSize: '12px' }}>↑ aspect-ratio: 1 · resolved = a 40px square</text>
                        </Col>
                    </Section>

                    <Section
                        title="Probe · #1075 layout & chains"
                        note="The constructs behind the empty progress track and the vertically-stacked tabs. Measured verdicts are recorded in the captions."
                    >
                        <Col gap={6}>
                            <view class="zxp-inline-flex">
                                <view class="zxp-inline-flex-cell" />
                                <view class="zxp-inline-flex-cell" />
                            </view>
                            <text style={{ fontSize: '12px' }}>↑ inline-flex · resolved = two cells side by side (#1075: NOT resolved — falls back to column)</text>
                            <view class="zxp-var-calc-chain"><text class="zxp-bar-label">var→calc chain width · resolved = 160px</text></view>
                            <text style={{ fontSize: '12px' }}>↑ (#1075: NOT resolved — the bar goes full-bleed)</text>
                            <view class="zxp-var-calc-height" />
                            <text style={{ fontSize: '12px' }}>↑ var→calc chain HEIGHT · resolved = a 20px indigo bar above (#1075: NOT resolved — nothing paints, the progress-track symptom)</text>
                            <view class="zxp-calc-height" />
                            <text style={{ fontSize: '12px' }}>↑ direct calc height control · a 20px green bar (proven working)</text>
                            <view style={{ display: 'flex', flexDirection: 'row', gap: '6px' }}>
                                <view class="zxp-vc-host"><view class="zxp-vc-chip zxp-vc-logical-inset" /></view>
                                <view class="zxp-vc-host"><view class="zxp-vc-chip zxp-vc-translate" /></view>
                                <view class="zxp-vc-host"><view class="zxp-vc-chip zxp-vc-physical" /></view>
                                <view class="zxp-vc-host"><view class="zxp-vc-chip zxp-vc-margin-block" /></view>
                            </view>
                            <text style={{ fontSize: '12px' }}>
                                ↑ vertical centering, centered chip = resolved: A inset-block-start · B translate ·
                                C physical top+transform · D margin-block-start (#1084: A, B and D fail on Android,
                                resolve on iOS — only C is cross-platform)
                            </text>
                        </Col>
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
