/**
 * Zero state-matrix gallery (#1141, epic #1140) — every axis value × every
 * forced interaction state of a lynx-zero scope, on one screen, with no
 * taps: the surface `scripts/zero-qa/shoot.mjs` screenshots.
 *
 *   /zero-gallery                    index (scopes → sections)
 *   /zero-gallery/:scope             every section of a scope, scrollable
 *   /zero-gallery/:scope/:section    one section, header hidden — one screenshot
 *
 * `?theme=<name>` picks the zero theme (default: the skin's light theme) and
 * themes the page edge to edge — status-bar strip included (`usePageTheme`).
 * Deep-linkable cold: `xcrun simctl openurl booted showcase://zero-gallery/button/color-1`.
 *
 * The DATA (axes, states, sections) lives in `scopes.ts`; this file pairs
 * each scope with its render fn. Held/focus states are forced through
 * `ForceStates` from `@sigx/lynx-zero/testing`, everything else through the
 * component's own props.
 */
import '@sigx/lynx-zero-daisyui/css/index.css';
// Side effect: seeds zero's theme registry + axis defaults with the daisy skin.
import '@sigx/lynx-zero-daisyui';
import './zero-gallery.css';
import type { Define, JSXElement } from '@sigx/lynx';
import { component, signal } from '@sigx/lynx';
import { extendTheme, registerTheme, themeController } from '@sigx/lynx-daisyui';
import { Screen, useFocusEffect, useNav, useParams, useSearch } from '@sigx/lynx-navigation';
import {
    Accordion, Button, Col, Dialog, Fieldset, NumberInput, Popover, Progress, Row, ScrollView, Select, Slider,
    Switch, Tabs, Timeline, Toast, Toggle, ToggleGroup, ZeroRoot, createToaster, getTheme,
} from '@sigx/lynx-zero';
import { Checkbox, CheckboxGroup, RadioGroup } from '@sigx/lynx-zero';
import { Field, Input, Textarea } from '@sigx/lynx-zero';
import { Alert, Card } from '@sigx/lynx-zero';
import { Badge, Kbd, Status } from '@sigx/lynx-zero';
import { Divider, EmptyState, Stats } from '@sigx/lynx-zero';
import { ForceStates } from '@sigx/lynx-zero/testing';
import { pageThemeOf } from './page-theme.js';
import type { GalleryAxis, GalleryScope, GalleryScopeId, GalleryState } from './scopes.js';
import {
    BLOCK_GAP, CELL_PAD, COLORS, FRAME_PADDING, GALLERY_SCOPES, LABEL_GAP, LABEL_WIDTH, LINE_GAP, SIZES,
    TEXT_FIELD_WIDTH, gallerySections, matrixOf, parseSection,
} from './scopes.js';

/** What one matrix cell renders: the swept axis value plus the state's props. */
export interface GalleryCell {
    color?: string;
    size?: string;
    variant?: string;
    state: GalleryState;
    props: Readonly<Record<string, unknown>>;
}

export interface GalleryRenderer {
    cell?: (cell: GalleryCell) => JSXElement;
    /** One render fn per `extras` id in `scopes.ts`. */
    extras?: Record<string, () => JSXElement>;
}

const FRUIT = [
    { value: 'apple', label: 'Apple', group: 'Fruit' },
    { value: 'banana', label: 'Banana', group: 'Fruit' },
    { value: 'carrot', label: 'Carrot', group: 'Veg' },
];

/** The select cells' list: FRUIT plus one label longer than a cell (#1191). */
const SELECT_ITEMS = [...FRUIT, { value: 'dragonfruit', label: 'Dragon fruit, yellow', group: 'Fruit' }];

const bool = (value: unknown): boolean => value === true;
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** A text field is fluid: its cell gives it a fixed width (`TEXT_FIELD_WIDTH`). */
const FIELD_BOX = { width: `${TEXT_FIELD_WIDTH}px` };

/** A divider cell: a fixed-width box the rule spans, one label line tall. */
const DIVIDER_CELL = { width: '70px', minHeight: '18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' };

/** The divider `vertical` extra's rows: the rules stretch to the row's height. */
const VERTICAL_ROW = { height: '48px', display: 'flex', flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-around' };

/** A stat figure: a 32pt disc (the room the skin keeps clear beside the bands). */
const STAT_FIGURE = {
    width: '32px', height: '32px', borderRadius: '16px', backgroundColor: 'rgba(127,127,127,0.2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
};

/** The radio-group `labelled` extra's data: one plan disabled. */
const PLANS = [
    { value: 'free', label: 'Free', disabled: false },
    { value: 'pro', label: 'Pro', disabled: false },
    { value: 'team', label: 'Team (sold out)', disabled: true },
];

/** The render half of the registry — one entry per scope in `scopes.ts`. */
/**
 * Readonly fields whose value changes after mount (#1231). Android's field
 * rejects every text write while readonly, so the runtime lifts the flag
 * around the write. The values flip once, 600ms after mount, then hold, so a
 * settled shot shows the later values ("after") and never the mount ones.
 */
const ReadonlyUpdate = component(({ onMounted, onUnmounted }) => {
    const st = signal({ text: 'at mount', notes: 'at mount', qty: 1 as number | null });
    let timer: ReturnType<typeof setTimeout> | undefined;
    onMounted(() => {
        timer = setTimeout(() => {
            st.text = 'after';
            st.notes = 'after\nmount';
            st.qty = 7;
        }, 600);
    });
    onUnmounted(() => { if (timer !== undefined) clearTimeout(timer); });
    return () => (
        <Col gap={10}>
            <Input.Root readonly model={() => st.text} label="Readonly input">
                <Input.Label>Readonly input, updated after mount</Input.Label>
                <Input.Control><Input.Input placeholder="placeholder" /></Input.Control>
            </Input.Root>
            <Textarea.Root readonly model={() => st.notes} label="Readonly textarea">
                <Textarea.Label>Readonly textarea, updated after mount</Textarea.Label>
                <Textarea.Textarea placeholder="placeholder" />
            </Textarea.Root>
            <NumberInput.Root readonly model={() => st.qty} label="Readonly number">
                <NumberInput.Label>Readonly number, updated after mount</NumberInput.Label>
                <NumberInput.Control>
                    <NumberInput.DecrementTrigger />
                    <NumberInput.Input placeholder="0" />
                    <NumberInput.IncrementTrigger />
                </NumberInput.Control>
            </NumberInput.Root>
        </Col>
    );
});

const RENDER: Record<GalleryScopeId, GalleryRenderer> = {
    button: {
        cell: (c) => (
            <Button
                color={c.color}
                size={c.size}
                variant={c.variant}
                disabled={bool(c.props['disabled'])}
                loading={bool(c.props['loading'])}
            >
                <text>Btn</text>
            </Button>
        ),
        extras: {
            // daisy's btn modifiers. `wide`/`block` fill the row (wide capped
            // at 16rem); `square`/`circle` are 1:1 icon chips; `active` holds
            // the pressed rendering.
            modifiers: () => (
                <view style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Button mods={{ wide: true }}><text>Wide</text></Button>
                    <Button mods={{ block: true }}><text>Block</text></Button>
                    <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
                        {SIZES.map((size) => <Button key={`sq-${size}`} size={size} mods={{ square: true }}><text>+</text></Button>)}
                    </view>
                    <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
                        {SIZES.map((size) => <Button key={`ci-${size}`} size={size} variant="outline" mods={{ circle: true }}><text>+</text></Button>)}
                    </view>
                    <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
                        <Button><text>Rest</text></Button>
                        <Button mods={{ active: true }}><text>Active</text></Button>
                    </view>
                </view>
            ),
            // Buttons in dashed boxes narrower than their content. daisy's
            // btn is content-sized and never squeezed: each one overflows its
            // box whole, and no label breaks mid-word (#1165).
            squeeze: () => (
                <view style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <view style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '150px', borderWidth: '1px', borderStyle: 'dashed', borderColor: '#9ca3af' }}>
                        <Button size="lg" variant="outline"><text>Cancel</text></Button>
                        <Button size="lg" loading><text>Save changes</text></Button>
                    </view>
                    <view style={{ width: '60px', borderWidth: '1px', borderStyle: 'dashed', borderColor: '#9ca3af' }}>
                        <Button size="xl" loading><text>Btn</text></Button>
                    </view>
                    <view style={{ width: '60px', borderWidth: '1px', borderStyle: 'dashed', borderColor: '#9ca3af' }}>
                        <Button size="lg" variant="dash" disabled><text>Disabled</text></Button>
                    </view>
                </view>
            ),
        },
    },
    switch: {
        cell: (c) => (
            <Switch
                color={c.color}
                size={c.size}
                defaultChecked={bool(c.props['checked'])}
                disabled={bool(c.props['disabled'])}
                readonly={bool(c.props['readonly'])}
                invalid={bool(c.props['invalid'])}
            />
        ),
    },
    slider: {
        cell: (c) => (
            <Slider.Root
                color={c.color}
                size={c.size}
                min={0}
                max={100}
                defaultValue={bool(c.props['range']) ? [25, 70] : 40}
                marks={bool(c.props['marks']) ? [0, 50, 100] : undefined}
                disabled={bool(c.props['disabled'])}
                readonly={bool(c.props['readonly'])}
                invalid={bool(c.props['invalid'])}
            />
        ),
        extras: {
            // Vertical rails side by side: the sizes, then the states.
            vertical: () => (
                <view style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '16px' }}>
                    {SIZES.map((size) => (
                        <view key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                            <Slider.Root orientation="vertical" size={size} defaultValue={40} marks={[0, 50, 100]} />
                            <text class="zg-head">{size}</text>
                        </view>
                    ))}
                    <view style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <Slider.Root orientation="vertical" color="secondary" defaultValue={[20, 80]} />
                        <text class="zg-head">range</text>
                    </view>
                    <view style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <ForceStates flags={{ pressed: true }}>
                            <Slider.Root orientation="vertical" color="accent" defaultValue={60} />
                        </ForceStates>
                        <text class="zg-head">held</text>
                    </view>
                    <view style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <Slider.Root orientation="vertical" defaultValue={60} disabled />
                        <text class="zg-head">disabled</text>
                    </view>
                </view>
            ),
        },
    },
    progress: {
        cell: (c) => (
            <Progress.Root value={c.props['value'] as number | null} color={c.color} size={c.size}>
                <Progress.Track><Progress.Range /></Progress.Track>
            </Progress.Root>
        ),
        extras: {
            // Label + formatted ValueText; `complete` keeps the colour axis.
            text: () => (
                <Col gap={12}>
                    <Progress.Root value={62} label="Upload">
                        <Progress.Label>Uploading</Progress.Label>
                        <Progress.Track><Progress.Range /></Progress.Track>
                        <Progress.ValueText />
                    </Progress.Root>
                    <Progress.Root value={3} max={8} color="accent" getValueText={(v, { max }) => `${v} of ${max} files`}>
                        <Progress.Label>Files</Progress.Label>
                        <Progress.Track><Progress.Range /></Progress.Track>
                        <Progress.ValueText />
                    </Progress.Root>
                    <Progress.Root value={100} color="secondary">
                        <Progress.Label>Complete · secondary</Progress.Label>
                        <Progress.Track><Progress.Range /></Progress.Track>
                        <Progress.ValueText />
                    </Progress.Root>
                    <Progress.Root value={null} color="info">
                        <Progress.Label>Indeterminate</Progress.Label>
                        <Progress.Track><Progress.Range /></Progress.Track>
                    </Progress.Root>
                </Col>
            ),
        },
    },
    tabs: {
        cell: (c) => (
            <Tabs.Root
                defaultValue={(c.props['value'] as string | undefined) ?? 'a'}
                color={c.color}
                size={c.size}
                variant={c.variant}
            >
                <Tabs.List>
                    <Tabs.Tab value="a"><text>A</text></Tabs.Tab>
                    <Tabs.Tab value="b" disabled={bool(c.props['disabled'])}><text>B</text></Tabs.Tab>
                </Tabs.List>
            </Tabs.Root>
        ),
        extras: {
            indicator: () => (
                <Col gap={16}>
                    {(['border', 'lift', 'box'] as const).map((variant) => (
                        <Tabs.Root key={variant} defaultValue="two" variant={variant} color="primary">
                            <Tabs.List>
                                <Tabs.Tab value="one"><text>First</text></Tabs.Tab>
                                <Tabs.Tab value="two"><text>{`Second · ${variant}`}</text></Tabs.Tab>
                                <Tabs.Tab value="three"><text>Third</text></Tabs.Tab>
                            </Tabs.List>
                            {(['one', 'two', 'three'] as const).map((value) => (
                                <Tabs.Panel key={value} value={value}><text>{`The ${variant} panel of tab ${value}.`}</text></Tabs.Panel>
                            ))}
                        </Tabs.Root>
                    ))}
                </Col>
            ),
        },
    },
    accordion: {
        cell: (c) => (
            <Accordion.Root color={c.color} size={c.size} defaultValue={bool(c.props['open']) ? ['a'] : []} collapsible>
                <Accordion.Item value="a" disabled={bool(c.props['disabled'])}>
                    <Accordion.Trigger><text>Item</text></Accordion.Trigger>
                    <Accordion.Panel><text>Panel</text></Accordion.Panel>
                </Accordion.Item>
            </Accordion.Root>
        ),
        extras: {
            horizontal: () => (
                <Accordion.Root orientation="horizontal" defaultValue={['a']} multiple>
                    <Accordion.Item value="a">
                        <Accordion.Trigger><text>Open</text></Accordion.Trigger>
                        <Accordion.Panel><text>Side-by-side items.</text></Accordion.Panel>
                    </Accordion.Item>
                    <Accordion.Item value="b">
                        <Accordion.Trigger><text>Closed</text></Accordion.Trigger>
                        <Accordion.Panel><text>Hidden.</text></Accordion.Panel>
                    </Accordion.Item>
                </Accordion.Root>
            ),
        },
    },
    timeline: {
        cell: (c) => (
            <Timeline.Root color={c.color} size={c.size}>
                <Timeline.Item>
                    <Timeline.Marker color={c.props['markerColor'] as string | undefined} />
                    <Timeline.Content><text>one</text></Timeline.Content>
                    <Timeline.Connector />
                </Timeline.Item>
                <Timeline.Item>
                    <Timeline.Marker />
                    <Timeline.Content><text>two</text></Timeline.Content>
                </Timeline.Item>
            </Timeline.Root>
        ),
        extras: {
            horizontal: () => (
                <Timeline.Root orientation="horizontal" color="primary">
                    {(['Plan', 'Build', 'Ship'] as const).map((step, index, all) => (
                        <Timeline.Item key={step}>
                            <Timeline.Marker color={index === 2 ? 'success' : undefined} />
                            <Timeline.Content><text>{step}</text></Timeline.Content>
                            {index < all.length - 1 ? <Timeline.Connector /> : null}
                        </Timeline.Item>
                    ))}
                </Timeline.Root>
            ),
            long: () => (
                <Timeline.Root color="neutral">
                    {[
                        'Order placed. A long line of content that wraps across several lines beside its marker.',
                        'Payment failed. The card was declined, so the order is on hold until it is retried.',
                        'Retried.',
                    ].map((text, index, all) => (
                        <Timeline.Item key={text}>
                            <Timeline.Marker color={index === 1 ? 'error' : undefined} />
                            <Timeline.Content><text>{text}</text></Timeline.Content>
                            {index < all.length - 1 ? <Timeline.Connector /> : null}
                        </Timeline.Item>
                    ))}
                </Timeline.Root>
            ),
        },
    },
    dialog: {
        cell: (c) => (
            <Dialog.Root color={c.color} size={c.size}>
                <Dialog.Trigger disabled={bool(c.props['disabled'])}><text>Open</text></Dialog.Trigger>
                <Dialog.Popup><Dialog.Title>Never opened</Dialog.Title></Dialog.Popup>
            </Dialog.Root>
        ),
        extras: {
            open: () => (
                <Dialog.Root defaultOpen dismissible={false}>
                    <Dialog.Trigger><text>Open dialog</text></Dialog.Trigger>
                    <Dialog.Popup>
                        <Dialog.Title>Confirm</Dialog.Title>
                        <Dialog.Description>A modal dialog rendered open for the gallery.</Dialog.Description>
                        <Dialog.Footer>
                            <Dialog.Cancel><text>Cancel</text></Dialog.Cancel>
                            <Dialog.Close><text>Close</text></Dialog.Close>
                        </Dialog.Footer>
                    </Dialog.Popup>
                </Dialog.Root>
            ),
            'open-states': () => (
                <Dialog.Root defaultOpen dismissible={false}>
                    <Dialog.Trigger><text>Open dialog</text></Dialog.Trigger>
                    <Dialog.Popup>
                        <Dialog.Title>Action states</Dialog.Title>
                        <Dialog.Description>Cancel held (pressed), Close disabled.</Dialog.Description>
                        <Dialog.Footer>
                            <ForceStates flags={{ pressed: true }}>
                                <Dialog.Cancel><text>Cancel</text></Dialog.Cancel>
                            </ForceStates>
                            <Dialog.Close disabled><text>Close</text></Dialog.Close>
                        </Dialog.Footer>
                    </Dialog.Popup>
                </Dialog.Root>
            ),
            nested: () => (
                <Dialog.Root defaultOpen dismissible={false}>
                    <Dialog.Trigger><text>Open dialog</text></Dialog.Trigger>
                    <Dialog.Popup>
                        <Dialog.Title>Pick inside a dialog</Dialog.Title>
                        <Dialog.Description>The list opens above the panel, not under the backdrop.</Dialog.Description>
                        <Select.Root
                            defaultOpen
                            items={FRUIT}
                            itemValue={(o) => o.value}
                            defaultValue="banana"
                            placeholder="Pick a fruit"
                        />
                        <Dialog.Footer>
                            <Dialog.Close><text>Close</text></Dialog.Close>
                        </Dialog.Footer>
                    </Dialog.Popup>
                </Dialog.Root>
            ),
            // #1232: tap Bio — the panel lifts above the keyboard, Bio and
            // the footer stay visible; add lines and it scrolls inside.
            keyboard: () => (
                <Dialog.Root defaultOpen dismissible={false}>
                    <Dialog.Trigger><text>Open dialog</text></Dialog.Trigger>
                    <Dialog.Popup>
                        <Dialog.Title>Edit profile</Dialog.Title>
                        <Dialog.Description>Focus a field: the panel stays above the keyboard.</Dialog.Description>
                        <Field.Root>
                            <Field.Label>Name</Field.Label>
                            <Input.Root defaultValue="Ada Lovelace" label="Name">
                                <Input.Control><Input.Input /></Input.Control>
                            </Input.Root>
                        </Field.Root>
                        <Field.Root>
                            <Field.Label>Bio</Field.Label>
                            <Textarea.Root defaultValue={'Mathematician.\nWrote the first program.'} minRows={3} maxRows={8} label="Bio">
                                <Textarea.Textarea />
                            </Textarea.Root>
                        </Field.Root>
                        <Dialog.Footer>
                            <Dialog.Cancel><text>Cancel</text></Dialog.Cancel>
                            <Dialog.Close><text>Save</text></Dialog.Close>
                        </Dialog.Footer>
                    </Dialog.Popup>
                </Dialog.Root>
            ),
        },
    },
    popover: {
        cell: (c) => (
            <Popover.Root color={c.color} size={c.size}>
                <Popover.Trigger disabled={bool(c.props['disabled'])}><text>Open</text></Popover.Trigger>
                <Popover.Popup><Popover.Title>Never opened</Popover.Title></Popover.Popup>
            </Popover.Root>
        ),
        extras: {
            open: () => (
                <Col gap={150}>
                    {(['primary', 'accent'] as const).map((color) => (
                        <Popover.Root key={color} defaultOpen color={color} placement="bottom-start">
                            <Popover.Trigger><text>{`Popover ${color}`}</text></Popover.Trigger>
                            <Popover.Popup>
                                <Popover.Title>{`Anchored · ${color}`}</Popover.Title>
                                <Popover.Description>Description part (zero 0.6)</Popover.Description>
                                <Popover.Close><text>×</text></Popover.Close>
                            </Popover.Popup>
                        </Popover.Root>
                    ))}
                </Col>
            ),
            'open-states': () => (
                <Col gap={150}>
                    {(['pressed', 'disabled'] as const).map((state) => (
                        <Popover.Root key={state} defaultOpen placement="bottom-start">
                            <Popover.Trigger><text>{`Close ${state}`}</text></Popover.Trigger>
                            <Popover.Popup>
                                <Popover.Title>{`Close · ${state}`}</Popover.Title>
                                {state === 'pressed'
                                    ? <ForceStates flags={{ pressed: true }}><Popover.Close><text>×</text></Popover.Close></ForceStates>
                                    : <Popover.Close disabled><text>×</text></Popover.Close>}
                            </Popover.Popup>
                        </Popover.Root>
                    ))}
                </Col>
            ),
        },
    },
    select: {
        cell: (c) => (
            <Select.Root
                items={SELECT_ITEMS}
                itemValue={(o) => o.value}
                placeholder="Pick"
                defaultValue={(c.props['value'] as string | undefined) ?? null}
                color={c.color}
                size={c.size}
                invalid={bool(c.props['invalid'])}
                disabled={bool(c.props['disabled'])}
                readonly={bool(c.props['readonly'])}
                clearable={bool(c.props['clearable'])}
            />
        ),
        extras: {
            open: () => (
                <Select.Root
                    defaultOpen
                    items={FRUIT}
                    itemValue={(o) => o.value}
                    itemGroup={(o) => o.group}
                    defaultValue="banana"
                    placeholder="Pick a fruit"
                    label="Fruit"
                />
            ),
            'open-parts': () => (
                <ForceStates flags={{ pressed: true }} parts={['item']}>
                    <Select.Root
                        defaultOpen
                        clearable
                        groupSeparators
                        items={FRUIT}
                        itemValue={(o) => o.value}
                        itemGroup={(o) => o.group}
                        defaultValue="banana"
                        placeholder="Pick a fruit"
                        label="Fruit"
                    />
                </ForceStates>
            ),
            'open-color': () => (
                <Select.Root
                    defaultOpen
                    clearable
                    groupSeparators
                    color="secondary"
                    items={FRUIT}
                    itemValue={(o) => o.value}
                    itemGroup={(o) => o.group}
                    defaultValue="banana"
                    placeholder="Pick a fruit"
                    label="Fruit"
                />
            ),
        },
    },
    toast: {
        cell: (c) => (
            <Toast.Root color={c.color} size={c.size}>
                <Toast.Title>Saved</Toast.Title>
                <Toast.Description>Changes stored.</Toast.Description>
                <Toast.Action disabled={bool(c.props['actionDisabled'])}><text>Undo</text></Toast.Action>
                <Toast.Close />
            </Toast.Root>
        ),
        extras: {
            open: () => <ToastsOpen placement="top" />,
            bottom: () => <ToastsOpen placement="bottom" />,
        },
    },
    toggle: {
        cell: (c) => (
            <Toggle.Root
                color={c.color}
                size={c.size}
                defaultPressed={bool(c.props['on'])}
                disabled={bool(c.props['disabled'])}
            >
                <text>Bold</text>
            </Toggle.Root>
        ),
        extras: {
            // A glyph + label row on both states, then a toggle in a box
            // narrower than its content: it overflows whole, never wraps.
            content: () => (
                <Col gap={12}>
                    <Row gap={10} align="center">
                        <Toggle.Root label="Star"><text>★</text><text>Star</text></Toggle.Root>
                        <Toggle.Root label="Star" defaultPressed color="warning"><text>★</text><text>Starred</text></Toggle.Root>
                        <Toggle.Root label="Bold" size="sm" color="neutral" defaultPressed><text>B</text></Toggle.Root>
                    </Row>
                    <view style={{ width: '60px', borderWidth: '1px', borderStyle: 'dashed', borderColor: '#9ca3af' }}>
                        <Toggle.Root size="lg"><text>Notifications</text></Toggle.Root>
                    </view>
                </Col>
            ),
        },
    },
    'toggle-group': {
        cell: (c) => (
            <ToggleGroupCell
                color={c.color}
                size={c.size}
                initial={(c.props['value'] as string | undefined) ?? 'a'}
                disabled={bool(c.props['disabled'])}
                itemDisabled={bool(c.props['itemDisabled'])}
                invalid={bool(c.props['invalid'])}
            />
        ),
        extras: {
            vertical: () => (
                <Col gap={12}>
                    <Row gap={12} align="flex-start">
                        {SIZES.map((size) => (
                            <ToggleGroup.Root key={size} orientation="vertical" size={size} defaultValue="b">
                                <ToggleGroup.Item value="a"><text>Top</text></ToggleGroup.Item>
                                <ToggleGroup.Item value="b"><text>Mid</text></ToggleGroup.Item>
                                <ToggleGroup.Item value="c"><text>End</text></ToggleGroup.Item>
                            </ToggleGroup.Root>
                        ))}
                    </Row>
                    {/* The ends filled (#1218): the first and last items round their own corners. */}
                    <Row gap={12} align="flex-start">
                        <ToggleGroup.Root orientation="vertical" defaultValue="a">
                            <ToggleGroup.Item value="a"><text>Top</text></ToggleGroup.Item>
                            <ToggleGroup.Item value="b"><text>Mid</text></ToggleGroup.Item>
                            <ToggleGroup.Item value="c"><text>End</text></ToggleGroup.Item>
                        </ToggleGroup.Root>
                        <ToggleGroup.Root orientation="vertical" defaultValue="c" color="secondary">
                            <ToggleGroup.Item value="a"><text>Top</text></ToggleGroup.Item>
                            <ToggleGroup.Item value="b"><text>Mid</text></ToggleGroup.Item>
                            <ToggleGroup.Item value="c"><text>End</text></ToggleGroup.Item>
                        </ToggleGroup.Root>
                        <ForceStates flags={{ pressed: true }}>
                            <ToggleGroup.Root orientation="vertical" defaultValue="a" color="accent">
                                <ToggleGroup.Item value="a"><text>Top</text></ToggleGroup.Item>
                                <ToggleGroup.Item value="b"><text>Mid</text></ToggleGroup.Item>
                                <ToggleGroup.Item value="c"><text>End</text></ToggleGroup.Item>
                            </ToggleGroup.Root>
                        </ForceStates>
                        <ForceStates flags={{ 'focus-visible': true }}>
                            <ToggleGroup.Root orientation="vertical" defaultValue="c">
                                <ToggleGroup.Item value="a"><text>Top</text></ToggleGroup.Item>
                                <ToggleGroup.Item value="b"><text>Mid</text></ToggleGroup.Item>
                                <ToggleGroup.Item value="c"><text>End</text></ToggleGroup.Item>
                            </ToggleGroup.Root>
                        </ForceStates>
                    </Row>
                </Col>
            ),
            multiple: () => (
                <Col gap={12}>
                    <ToggleGroup.Root multiple defaultValue={['bold', 'underline']} color="secondary">
                        <ToggleGroup.Item value="bold" label="Bold"><text>B</text></ToggleGroup.Item>
                        <ToggleGroup.Item value="italic" label="Italic"><text>I</text></ToggleGroup.Item>
                        <ToggleGroup.Item value="underline" label="Underline"><text>U</text></ToggleGroup.Item>
                        <ToggleGroup.Item value="strike" label="Strikethrough"><text>S</text></ToggleGroup.Item>
                    </ToggleGroup.Root>
                    <ToggleGroup.Root defaultValue="center" deselectable={false} color="accent">
                        <ToggleGroup.Item value="left"><text>Left</text></ToggleGroup.Item>
                        <ToggleGroup.Item value="center"><text>Center</text></ToggleGroup.Item>
                        <ToggleGroup.Item value="right"><text>Right</text></ToggleGroup.Item>
                    </ToggleGroup.Root>
                </Col>
            ),
        },
    },
    checkbox: {
        cell: (c) => (
            <Checkbox.Root
                color={c.color}
                size={c.size}
                defaultChecked={bool(c.props['checked'])}
                indeterminate={bool(c.props['indeterminate'])}
                disabled={bool(c.props['disabled'])}
                readonly={bool(c.props['readonly'])}
                invalid={bool(c.props['invalid'])}
                label="Box"
            />
        ),
        extras: {
            // The label part beside the box at every size, then the states
            // that change it (disabled dims the row), and hideLabel.
            labelled: () => (
                <Col gap={12}>
                    {SIZES.map((size) => (
                        <Checkbox.Root key={size} size={size} defaultChecked>{`Accept the terms · ${size}`}</Checkbox.Root>
                    ))}
                    <Checkbox.Root color="secondary" indeterminate>Some selected · secondary</Checkbox.Root>
                    <Checkbox.Root disabled defaultChecked>Disabled</Checkbox.Root>
                    <Checkbox.Root readonly defaultChecked>Read only</Checkbox.Root>
                    <Checkbox.Root invalid required>Invalid · required</Checkbox.Root>
                    <Checkbox.Root hideLabel label="Hidden label" defaultChecked>Not shown</Checkbox.Root>
                </Col>
            ),
        },
    },
    'checkbox-group': {
        cell: (c) => (
            <CheckboxGroup.Root
                color={c.color}
                size={c.size}
                defaultValue={['a']}
                disabled={bool(c.props['disabled'])}
                readonly={bool(c.props['readonly'])}
                invalid={bool(c.props['invalid'])}
                required={bool(c.props['required'])}
            >
                <CheckboxGroup.Label>Pick</CheckboxGroup.Label>
                <Checkbox.Root value="a">A</Checkbox.Root>
                <Checkbox.Root value="b">B</Checkbox.Root>
            </CheckboxGroup.Root>
        ),
        extras: {
            // Some of three selected: the parent box is indeterminate.
            parent: () => (
                <Col gap={16}>
                    <CheckboxGroup.Root defaultValue={['ham']} color="primary">
                        <CheckboxGroup.Label>Toppings</CheckboxGroup.Label>
                        <Checkbox.Root parent>All toppings</Checkbox.Root>
                        <Checkbox.Root value="ham">Ham</Checkbox.Root>
                        <Checkbox.Root value="olives">Olives</Checkbox.Root>
                        <Checkbox.Root value="basil">Basil</Checkbox.Root>
                    </CheckboxGroup.Root>
                    <CheckboxGroup.Root defaultValue={['ham', 'olives', 'basil']} color="secondary" size="lg">
                        <CheckboxGroup.Label>All selected · lg</CheckboxGroup.Label>
                        <Checkbox.Root parent>All toppings</Checkbox.Root>
                        <Checkbox.Root value="ham">Ham</Checkbox.Root>
                        <Checkbox.Root value="olives">Olives</Checkbox.Root>
                        <Checkbox.Root value="basil">Basil</Checkbox.Root>
                    </CheckboxGroup.Root>
                </Col>
            ),
            horizontal: () => (
                <CheckboxGroup.Root orientation="horizontal" defaultValue={['news']} color="accent">
                    <CheckboxGroup.Label>Subscribe</CheckboxGroup.Label>
                    <Checkbox.Root value="news">News</Checkbox.Root>
                    <Checkbox.Root value="offers">Offers</Checkbox.Root>
                    <Checkbox.Root value="tips">Tips</Checkbox.Root>
                </CheckboxGroup.Root>
            ),
        },
    },
    'radio-group': {
        cell: (c) => (
            <RadioGroup.Root
                color={c.color}
                size={c.size}
                defaultValue="a"
                disabled={bool(c.props['disabled'])}
                readonly={bool(c.props['readonly'])}
                invalid={bool(c.props['invalid'])}
            >
                <RadioGroup.Item value="a">A</RadioGroup.Item>
                <RadioGroup.Item value="b">B</RadioGroup.Item>
            </RadioGroup.Root>
        ),
        extras: {
            // A labelled group (required) with one disabled item, then the
            // same choice in data mode (`items` — children win entirely, so
            // it takes no Label).
            labelled: () => (
                <Col gap={20}>
                    <RadioGroup.Root defaultValue="pro" color="secondary" required>
                        <RadioGroup.Label>Plan</RadioGroup.Label>
                        {PLANS.map((p) => <RadioGroup.Item key={p.value} value={p.value} disabled={p.disabled}>{p.label}</RadioGroup.Item>)}
                    </RadioGroup.Root>
                    <RadioGroup.Root items={PLANS} defaultValue="free" size="lg" />
                </Col>
            ),
            horizontal: () => (
                <RadioGroup.Root orientation="horizontal" defaultValue="md" color="accent">
                    <RadioGroup.Label>Size</RadioGroup.Label>
                    <RadioGroup.Item value="sm">Small</RadioGroup.Item>
                    <RadioGroup.Item value="md">Medium</RadioGroup.Item>
                    <RadioGroup.Item value="lg">Large</RadioGroup.Item>
                </RadioGroup.Root>
            ),
        },
    },
    input: {
        cell: (c) => (
            <view style={FIELD_BOX}>
                <Input.Root
                    color={c.color}
                    size={c.size}
                    type={bool(c.props['password']) ? 'password' : 'text'}
                    defaultValue={str(c.props['value'])}
                    defaultVisible={bool(c.props['visible'])}
                    invalid={bool(c.props['invalid'])}
                    disabled={bool(c.props['disabled'])}
                    readonly={bool(c.props['readonly'])}
                    label="Email"
                >
                    <Input.Control>
                        {bool(c.props['adornment']) ? <Input.Adornment placement="start"><text>@</text></Input.Adornment> : null}
                        <Input.Input placeholder="Email" />
                        {bool(c.props['adornment']) ? <Input.Adornment placement="end"><text>.com</text></Input.Adornment> : null}
                        {bool(c.props['password']) ? <Input.VisibilityTrigger /> : <Input.ClearTrigger />}
                    </Input.Control>
                </Input.Root>
            </view>
        ),
        extras: {
            affordances: () => (
                <Col gap={10}>
                    <Input.Root defaultValue="someone" label="User">
                        <Input.Label>Every affordance</Input.Label>
                        <Input.Control>
                            <Input.Adornment placement="start"><text>@</text></Input.Adornment>
                            <Input.Input placeholder="username" />
                            <Input.Adornment placement="end"><text>.dev</text></Input.Adornment>
                            <Input.ClearTrigger />
                        </Input.Control>
                    </Input.Root>
                    <ForceStates flags={{ 'focus-visible': true }} parts={['clear-trigger']}>
                        <Input.Root defaultValue="clear focused" label="Clear focus">
                            <Input.Control><Input.Input /><Input.ClearTrigger /></Input.Control>
                        </Input.Root>
                    </ForceStates>
                    <ForceStates flags={{ 'focus-visible': true }} parts={['visibility-trigger']}>
                        <Input.Root type="password" defaultValue="hunter2" defaultVisible label="Password">
                            <Input.Control><Input.Input /><Input.VisibilityTrigger /></Input.Control>
                        </Input.Root>
                    </ForceStates>
                    <view style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '8px' }}>
                        {COLORS.map((color) => (
                            <view key={color} style={{ width: '84px' }}>
                                <ForceStates flags={{ 'focus-visible': true }} parts={['control']}>
                                    <Input.Root color={color} size="sm" label={color}>
                                        <Input.Control><Input.Input placeholder={color} /></Input.Control>
                                    </Input.Root>
                                </ForceStates>
                            </view>
                        ))}
                    </view>
                </Col>
            ),
            'readonly-update': () => <ReadonlyUpdate />,
        },
    },
    textarea: {
        cell: (c) => (
            <view style={FIELD_BOX}>
                <Textarea.Root
                    color={c.color}
                    size={c.size}
                    defaultValue={str(c.props['value'])}
                    invalid={bool(c.props['invalid'])}
                    disabled={bool(c.props['disabled'])}
                    readonly={bool(c.props['readonly'])}
                    label="Notes"
                >
                    <Textarea.Textarea placeholder="Notes" />
                </Textarea.Root>
            </view>
        ),
        extras: {
            autosize: () => (
                <Col gap={10}>
                    {(['One line', 'Three\nshort\nlines', '1\n2\n3\n4\n5\n6\n7\n8']).map((text) => (
                        <Textarea.Root key={text} defaultValue={text} minRows={1} maxRows={5} label="Autosize">
                            <Textarea.Label>{`minRows 1 · maxRows 5 · ${text.split('\n').length} line(s)`}</Textarea.Label>
                            <Textarea.Textarea />
                        </Textarea.Root>
                    ))}
                </Col>
            ),
        },
    },
    field: {
        cell: (c) => (
            <view style={FIELD_BOX}>
                <Field.Root
                    color={c.color}
                    size={c.size}
                    required={bool(c.props['required'])}
                    invalid={bool(c.props['invalid'])}
                    disabled={bool(c.props['disabled'])}
                    readonly={bool(c.props['readonly'])}
                >
                    <Field.Label>Email</Field.Label>
                    <Input.Root defaultValue="a@b.co" label="Email">
                        <Input.Control><Input.Input /></Input.Control>
                    </Input.Root>
                    {bool(c.props['invalid'])
                        ? <Field.Error>Enter a valid email.</Field.Error>
                        : <Field.Description>Never shared.</Field.Description>}
                </Field.Root>
            </view>
        ),
        extras: {
            controls: () => (
                <Col gap={14}>
                    <Field.Root required>
                        <Field.Label>Bio (Textarea)</Field.Label>
                        <Textarea.Root defaultValue="Hello" label="Bio"><Textarea.Textarea /></Textarea.Root>
                        <Field.Description>Adopts required.</Field.Description>
                    </Field.Root>
                    <Field.Root readonly>
                        <Field.Label>Alerts (Switch)</Field.Label>
                        <Switch defaultChecked />
                        <Field.Description>Readonly — taps refused.</Field.Description>
                    </Field.Root>
                    <Field.Root invalid size="sm">
                        <Field.Label>Fruit (Select)</Field.Label>
                        <Select.Root items={FRUIT} itemValue={(o) => o.value} placeholder="Pick" />
                        <Field.Error>Pick one.</Field.Error>
                    </Field.Root>
                    <Field.Root disabled size="lg">
                        <Field.Label>Name (Input, lg)</Field.Label>
                        <Input.Root defaultValue="Ada" label="Name"><Input.Control><Input.Input /></Input.Control></Input.Root>
                    </Field.Root>
                </Col>
            ),
        },
    },
    'number-input': {
        cell: (c) => (
            <NumberInput.Root
                color={c.color}
                size={c.size}
                min={0}
                max={10}
                defaultValue={bool(c.props['empty']) ? null : bool(c.props['atMax']) ? 10 : 5}
                invalid={bool(c.props['invalid'])}
                disabled={bool(c.props['disabled'])}
                readonly={bool(c.props['readonly'])}
            >
                <NumberInput.Control>
                    <NumberInput.DecrementTrigger />
                    <NumberInput.Input placeholder="0" />
                    <NumberInput.IncrementTrigger />
                </NumberInput.Control>
            </NumberInput.Root>
        ),
        extras: {
            // The full anatomy at every size: label part + a custom format
            // (a text field on lynx, #1221) whose parse reads the edited
            // "25 %" back. A tap on a label focuses its field (#1223).
            label: () => (
                <Col gap={12}>
                    {SIZES.map((size) => (
                        <NumberInput.Root
                            key={size}
                            size={size}
                            min={0}
                            step={5}
                            defaultValue={25}
                            format={(v: number) => `${v} %`}
                            parse={(t: string) => {
                                const n = Number(t.replace('%', '').trim());
                                return t.trim() !== '' && Number.isFinite(n) ? n : null;
                            }}
                        >
                            <NumberInput.Label>{`Opacity (${size})`}</NumberInput.Label>
                            <NumberInput.Control>
                                <NumberInput.DecrementTrigger />
                                <NumberInput.Input />
                                <NumberInput.IncrementTrigger />
                            </NumberInput.Control>
                        </NumberInput.Root>
                    ))}
                </Col>
            ),
        },
    },
    fieldset: {
        cell: (c) => (
            <Fieldset.Root
                color={c.color}
                size={c.size}
                disabled={bool(c.props['disabled'])}
                readonly={bool(c.props['readonly'])}
                invalid={bool(c.props['invalid'])}
            >
                <Fieldset.Legend>Shipping</Fieldset.Legend>
                <NumberInput.Root size="xs" min={0} defaultValue={2}>
                    <NumberInput.Control>
                        <NumberInput.DecrementTrigger />
                        <NumberInput.Input />
                        <NumberInput.IncrementTrigger />
                    </NumberInput.Control>
                </NumberInput.Root>
            </Fieldset.Root>
        ),
        extras: {
            // Outer disabled reaches the inner group and its control; a
            // second, enabled group beside it for contrast.
            nested: () => (
                <Col gap={16}>
                    <Fieldset.Root disabled>
                        <Fieldset.Legend>Outer (disabled)</Fieldset.Legend>
                        <Fieldset.Root color="secondary">
                            <Fieldset.Legend>Inner (inherits)</Fieldset.Legend>
                            <NumberInput.Root min={0} defaultValue={3}>
                                <NumberInput.Label>Quantity</NumberInput.Label>
                                <NumberInput.Control>
                                    <NumberInput.DecrementTrigger />
                                    <NumberInput.Input />
                                    <NumberInput.IncrementTrigger />
                                </NumberInput.Control>
                            </NumberInput.Root>
                        </Fieldset.Root>
                    </Fieldset.Root>
                    <Fieldset.Root color="primary" invalid>
                        <Fieldset.Legend>Invalid group</Fieldset.Legend>
                        <NumberInput.Root min={0} defaultValue={3}>
                            <NumberInput.Label>Quantity</NumberInput.Label>
                            <NumberInput.Control>
                                <NumberInput.DecrementTrigger />
                                <NumberInput.Input />
                                <NumberInput.IncrementTrigger />
                            </NumberInput.Control>
                        </NumberInput.Root>
                    </Fieldset.Root>
                </Col>
            ),
        },
    },
    // ── Wave 3, display (W3B #1235) ──
    alert: {
        cell: (c) => (
            <Alert.Root color={c.color} size={c.size}>
                <Alert.Icon><text>!</text></Alert.Icon>
                <Alert.Title>Quota</Alert.Title>
                <Alert.Description>92% used.</Alert.Description>
                <Alert.Close disabled={bool(c.props['closeDisabled'])} />
            </Alert.Root>
        ),
        extras: {
            // Each optional part left out in turn, then a live alert: tap ×
            // to dismiss it (the root unmounts), "Show again" brings it back.
            compose: () => (
                <Col gap={10}>
                    <Alert.Root color="info">
                        <Alert.Title>No icon</Alert.Title>
                        <Alert.Description>Title, description and close.</Alert.Description>
                        <Alert.Close />
                    </Alert.Root>
                    <Alert.Root color="success">
                        <Alert.Icon><text>✓</text></Alert.Icon>
                        <Alert.Title>No close</Alert.Title>
                        <Alert.Description>Icon, title and description.</Alert.Description>
                    </Alert.Root>
                    <Alert.Root color="warning">
                        <Alert.Icon><text>!</text></Alert.Icon>
                        <Alert.Title>Title only, with a close</Alert.Title>
                        <Alert.Close />
                    </Alert.Root>
                    <Alert.Root color="error">
                        <Alert.Icon><text>×</text></Alert.Icon>
                        <Alert.Description>A description only: it takes the title's place beside the icon.</Alert.Description>
                    </Alert.Root>
                    <Alert.Root>
                        <Alert.Title>Default (no color)</Alert.Title>
                        <Alert.Description>The skin's own tint.</Alert.Description>
                    </Alert.Root>
                    <AlertLive />
                </Col>
            ),
        },
    },
    card: {
        cell: (c) => (
            <Card.Root color={c.color} size={c.size}>
                <Card.Header>
                    <Card.Title>Report</Card.Title>
                    <Card.Description>Updated</Card.Description>
                </Card.Header>
                <Card.Body><text>Body</text></Card.Body>
            </Card.Root>
        ),
        extras: {
            // A media band at the top (corners shared with the card's top)
            // and at the bottom (its bottom corners); a flat colour block
            // stands in for the image.
            media: () => (
                <Col gap={16}>
                    <Card.Root>
                        <Card.Media><view style={{ width: '100%', height: '96px', backgroundColor: '#7c9cbf' }} /></Card.Media>
                        <Card.Header>
                            <Card.Title>Media on top</Card.Title>
                            <Card.Description>The band's top corners follow the card.</Card.Description>
                        </Card.Header>
                        <Card.Body><text>Body copy under the header.</text></Card.Body>
                    </Card.Root>
                    <Card.Root color="secondary">
                        <Card.Header>
                            <Card.Title>Media below</Card.Title>
                        </Card.Header>
                        <Card.Body><text>With a colour's top rule.</text></Card.Body>
                        <Card.Media><view style={{ width: '100%', height: '72px', backgroundColor: '#b58fb8' }} /></Card.Media>
                    </Card.Root>
                </Col>
            ),
            // Every part at once: header, body, footer actions.
            bands: () => (
                <Col gap={16}>
                    <Card.Root>
                        <Card.Header>
                            <Card.Title>Monthly report</Card.Title>
                            <Card.Description>Updated 4 minutes ago</Card.Description>
                        </Card.Header>
                        <Card.Body><text>Revenue is up 12% on last month; three invoices are overdue.</text></Card.Body>
                        <Card.Footer>
                            <Button variant="ghost" size="sm"><text>Later</text></Button>
                            <Button color="primary" size="sm"><text>Open</text></Button>
                        </Card.Footer>
                    </Card.Root>
                    <Card.Root size="xs" color="accent">
                        <Card.Body><text>A bare xs card: root and body only.</text></Card.Body>
                    </Card.Root>
                </Col>
            ),
        },
    },
    // ── Wave 3, display (W3A #1234) ──────────────────────────────────────
    badge: {
        cell: (c) => (
            <Badge.Root color={c.color} size={c.size}>
                {bool(c.props['dot'])
                    ? <Badge.Dot color={str(c.props['dotColor'])} running={bool(c.props['running'])} />
                    : null}
                <text>Tag</text>
            </Badge.Root>
        ),
        extras: {
            // Each role's dot on an uncoloured pill, at rest and running,
            // then the uncoloured dot (the pill's own ink).
            dots: () => (
                <Col gap={8}>
                    {COLORS.map((color) => (
                        <Row key={color} gap={8} align="center">
                            <Badge.Root><Badge.Dot color={color} /><text>{color}</text></Badge.Root>
                            <Badge.Root><Badge.Dot color={color} running /><text>running</text></Badge.Root>
                            <Badge.Root color={color}><Badge.Dot color={color} /><text>same role</text></Badge.Root>
                        </Row>
                    ))}
                    <Row gap={8} align="center">
                        <Badge.Root><Badge.Dot /><text>ink dot</text></Badge.Root>
                        <Badge.Root><Badge.Dot running /><text>ink running</text></Badge.Root>
                        <Badge.Root label="3 unread" color="error"><text>3</text></Badge.Root>
                    </Row>
                </Col>
            ),
        },
    },
    status: {
        cell: (c) => <Status.Root color={c.color} size={c.size} label={str(c.props['label'])} />,
        extras: {
            // The dot decorating the text beside it, every size.
            'with-text': () => (
                <Col gap={10}>
                    {SIZES.map((size, index) => (
                        <Row key={size} gap={8} align="center">
                            <Status.Root size={size} color={(['success', 'warning', 'error', 'info', 'neutral'] as const)[index]} />
                            <text>{`${size} — ${(['Online', 'Away', 'Busy', 'Syncing', 'Offline'] as const)[index]}`}</text>
                        </Row>
                    ))}
                    <Row gap={8} align="center">
                        <Status.Root />
                        <text>uncoloured (base-content)</text>
                    </Row>
                </Col>
            ),
        },
    },
    kbd: {
        cell: (c) => (
            <Kbd.Root color={c.color} size={c.size}>
                <text>{str(c.props['glyph']) ?? 'K'}</text>
            </Kbd.Root>
        ),
        extras: {
            // A shortcut in running text at every size, then a coloured cap.
            shortcut: () => (
                <Col gap={10}>
                    {SIZES.map((size) => (
                        <Row key={size} gap={4} align="center">
                            <text>{`${size}: press`}</text>
                            <Kbd.Root size={size} label="Command"><text>⌘</text></Kbd.Root>
                            <Kbd.Root size={size}><text>K</text></Kbd.Root>
                            <text>to search</text>
                        </Row>
                    ))}
                    <Row gap={4} align="center">
                        <Kbd.Root color="primary"><text>Ctrl</text></Kbd.Root>
                        <text>+</text>
                        <Kbd.Root color="primary"><text>Shift</text></Kbd.Root>
                        <text>+</text>
                        <Kbd.Root color="primary"><text>P</text></Kbd.Root>
                    </Row>
                </Col>
            ),
        },
    },
    // W3D (#1236).
    divider: {
        cell: (c) => (
            <view style={DIVIDER_CELL}>
                {str(c.props['label']) === undefined
                    ? <Divider.Root color={c.color} size={c.size} />
                    : (
                        <Divider.Root color={c.color} size={c.size}>
                            <Divider.Label placement={str(c.props['placement']) as 'start' | 'end' | undefined}>
                                {str(c.props['label'])}
                            </Divider.Label>
                        </Divider.Root>
                    )}
            </view>
        ),
        extras: {
            // Vertical rules between items (bare, coloured, xl), then a
            // labelled vertical rule and both placements.
            vertical: () => (
                <view style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <view style={VERTICAL_ROW}>
                        <text>One</text>
                        <Divider.Root orientation="vertical" />
                        <text>Two</text>
                        <Divider.Root orientation="vertical" color="primary" />
                        <text>Three</text>
                        <Divider.Root orientation="vertical" color="error" size="xl" />
                        <text>Four</text>
                    </view>
                    <view style={{ ...VERTICAL_ROW, height: '120px' }}>
                        <text>A</text>
                        <Divider.Root orientation="vertical" color="secondary">
                            <Divider.Label>or</Divider.Label>
                        </Divider.Root>
                        <text>B</text>
                        <Divider.Root orientation="vertical">
                            <Divider.Label placement="start">top</Divider.Label>
                        </Divider.Root>
                        <text>C</text>
                        <Divider.Root orientation="vertical">
                            <Divider.Label placement="end">end</Divider.Label>
                        </Divider.Root>
                        <text>D</text>
                    </view>
                    <Divider.Root color="neutral" size="lg">
                        <Divider.Label>Continue with</Divider.Label>
                    </Divider.Root>
                </view>
            ),
        },
    },
    // W3D (#1236).
    stats: {
        cell: (c) => (
            <Stats.Root color={c.color} size={c.size}>
                <Stats.Item color={str(c.props['itemColor'])}>
                    {bool(c.props['figure']) ? <Stats.Figure><view style={STAT_FIGURE}><text>$</text></view></Stats.Figure> : null}
                    <Stats.Title>Sales</Stats.Title>
                    <Stats.Value>129</Stats.Value>
                    <Stats.Desc>+8%</Stats.Desc>
                </Stats.Item>
            </Stats.Root>
        ),
        extras: {
            // Seams between items: none before the first (the `first` stamp).
            row: () => (
                <view style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <Stats.Root>
                        <Stats.Item>
                            <Stats.Figure><view style={STAT_FIGURE}><text>↓</text></view></Stats.Figure>
                            <Stats.Title>Downloads</Stats.Title>
                            <Stats.Value>31K</Stats.Value>
                            <Stats.Desc>Jan 1 – Feb 1</Stats.Desc>
                        </Stats.Item>
                        <Stats.Item color="success">
                            <Stats.Title>Users</Stats.Title>
                            <Stats.Value>4,200</Stats.Value>
                            <Stats.Desc>↗︎ 400 (22%)</Stats.Desc>
                        </Stats.Item>
                    </Stats.Root>
                    <Stats.Root color="primary" size="sm">
                        <Stats.Item><Stats.Title>A</Stats.Title><Stats.Value>1</Stats.Value></Stats.Item>
                        <Stats.Item><Stats.Title>B</Stats.Title><Stats.Value>2</Stats.Value></Stats.Item>
                        <Stats.Item color="error"><Stats.Title>C</Stats.Title><Stats.Value>3</Stats.Value></Stats.Item>
                    </Stats.Root>
                </view>
            ),
            column: () => (
                <Stats.Root orientation="vertical">
                    <Stats.Item>
                        <Stats.Figure><view style={STAT_FIGURE}><text>↓</text></view></Stats.Figure>
                        <Stats.Title>Downloads</Stats.Title>
                        <Stats.Value>31K</Stats.Value>
                        <Stats.Desc>Jan 1 – Feb 1</Stats.Desc>
                    </Stats.Item>
                    <Stats.Item color="warning">
                        <Stats.Title>New registers</Stats.Title>
                        <Stats.Value>1,200</Stats.Value>
                        <Stats.Desc>↘︎ 90 (14%)</Stats.Desc>
                    </Stats.Item>
                    <Stats.Item>
                        <Stats.Title>Users</Stats.Title>
                        <Stats.Value>4,200</Stats.Value>
                    </Stats.Item>
                </Stats.Root>
            ),
        },
    },
    // W3D (#1236).
    'empty-state': {
        cell: (c) => (
            <EmptyState.Root color={c.color} size={c.size}>
                <EmptyState.Icon><text>☆</text></EmptyState.Icon>
                <EmptyState.Title>No items</EmptyState.Title>
                <EmptyState.Description>Nothing yet</EmptyState.Description>
                {bool(c.props['actions'])
                    ? (
                        <EmptyState.Actions>
                            <Button.Root size="xs" color={c.color}><text>Add</text></Button.Root>
                        </EmptyState.Actions>
                    )
                    : null}
            </EmptyState.Root>
        ),
    },
};

/** A live alert for the `compose` extra: × dismisses it, the button restores it. */
const AlertLive = component(() => {
    const state = signal({ open: true });
    return () => (
        <Col gap={6}>
            <Alert.Root color="primary" model={() => state.open}>
                <Alert.Icon><text>i</text></Alert.Icon>
                <Alert.Title>Live: tap × to dismiss</Alert.Title>
                <Alert.Close />
            </Alert.Root>
            {state.open ? null : <Button size="sm" onPress={() => { state.open = true; }}><text>Show again</text></Button>}
        </Col>
    );
});

type ToggleGroupCellProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'initial', string, true>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'itemDisabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>;

/** One toggle-group cell: three items, `initial` on ('' = none). */
const ToggleGroupCell = component<ToggleGroupCellProps>(({ props }) => () => (
    <ToggleGroup.Root
        color={props.color}
        size={props.size}
        defaultValue={props.initial}
        disabled={props.disabled}
        invalid={props.invalid}
    >
        <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
        <ToggleGroup.Item value="b" disabled={props.itemDisabled}><text>B</text></ToggleGroup.Item>
        <ToggleGroup.Item value="c"><text>C</text></ToggleGroup.Item>
    </ToggleGroup.Root>
));

/** Toasts need a live store: three pinned toasts (duration 0 = no timer). */
const ToastsOpen = component<Define.Prop<'placement', 'top' | 'bottom', true>>(({ props }) => {
    const toaster = createToaster();
    toaster.show({ title: 'Saved', description: 'Your changes were saved.', duration: 0 });
    toaster.show({ title: 'Deleted', description: 'One item removed.', color: 'error', action: { label: 'Undo' }, duration: 0 });
    toaster.show({ title: 'Title only', duration: 0 });
    return () => <Toast.Viewport placement={props.placement} toaster={toaster} />;
});

function forced(state: GalleryState, node: JSXElement): JSXElement {
    if (!state.flags) return node;
    return <ForceStates flags={state.flags} parts={state.parts}>{node}</ForceStates>;
}

type MatrixProps =
    & Define.Prop<'scope', GalleryScopeId, true>
    & Define.Prop<'axis', GalleryAxis, true>
    & Define.Prop<'values', readonly string[], true>;

/**
 * One axis block: a header row of state labels, then one row per axis value.
 * The geometry (column width, label placement, gaps) is the same one
 * `scopes.ts` paginates with, so a page the model says fits does fit.
 */
const Matrix = component<MatrixProps>(({ props }) => {
    return () => {
        const entry: GalleryScope = GALLERY_SCOPES[props.scope];
        const render = RENDER[props.scope].cell;
        const { cellWidth } = matrixOf(entry);
        const above = entry.labels === 'above';
        // Label column (or a label line above) + a wrapping cell area: when
        // the states wrap onto a second line they stay under the header's
        // columns, not the label.
        const row: Record<string, string> = above
            ? { display: 'flex', flexDirection: 'column', gap: `${LABEL_GAP}px` }
            : { display: 'flex', flexDirection: 'row', alignItems: 'flex-start' };
        const cells = { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: `${LINE_GAP}px`, flexGrow: 1, flexShrink: 1, flexBasis: '0px' };
        const labelStyle: Record<string, string> = above ? {} : { width: `${LABEL_WIDTH}px`, paddingTop: '4px' };
        return (
            <view style={{ display: 'flex', flexDirection: 'column', gap: `${BLOCK_GAP}px` }}>
                <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start' }}>
                    {above ? null : <view style={{ width: `${LABEL_WIDTH}px` }} />}
                    <view style={cells}>
                        {entry.states.map((state) => (
                            <text key={state.id} class="zg-head" style={{ width: `${cellWidth}px` }}>{state.label}</text>
                        ))}
                    </view>
                </view>
                {props.values.map((value) => (
                    <view key={value} style={row}>
                        <text class="zg-label" style={labelStyle}>{value}</text>
                        <view style={above ? { ...cells, flexGrow: 0, flexBasis: 'auto', width: '100%' } : cells}>
                            {entry.states.map((state) => (
                                <view key={state.id} style={{ width: `${cellWidth}px`, paddingRight: `${CELL_PAD}px` }}>
                                    {render
                                        ? forced(state, render({ [props.axis]: value, state, props: state.props ?? {} } as GalleryCell))
                                        : null}
                                </view>
                            ))}
                        </view>
                    </view>
                ))}
            </view>
        );
    };
});

type SectionProps = Define.Prop<'scope', GalleryScopeId, true> & Define.Prop<'section', string, true>;

/** One section: an axis block (optionally one page of it) or an extra. */
const Section = component<SectionProps>(({ props }) => {
    return () => {
        const entry: GalleryScope = GALLERY_SCOPES[props.scope];
        const parsed = parseSection(entry, props.section);
        const body = parsed?.kind === 'axis'
            ? <Matrix scope={props.scope} axis={parsed.axis} values={parsed.values} />
            : parsed?.kind === 'extra'
                ? RENDER[props.scope].extras?.[parsed.id]?.() ?? null
                : <text class="zg-error">{`Unknown section "${props.section}" — have: ${gallerySections(props.scope).join(', ')}`}</text>;
        return (
            <view style={{ display: 'flex', flexDirection: 'column', gap: `${BLOCK_GAP}px`, paddingBottom: '12px' }}>
                <text class="zg-title">{`${entry.title} · ${props.section}`}</text>
                {body}
            </view>
        );
    };
});

/**
 * `?theme=<name>` themes the whole page, not just the ZeroRoot subtree:
 * while this screen is focused the app theme mirrors the zero theme, so the
 * status-bar and home-indicator strips (painted by the app shell) and the
 * status-bar icons follow it too (#1193). See `page-theme.ts`.
 *
 * What `useScreenTheme` does (save, pin, restore on blur), with the focus
 * effect registered unconditionally so the hook runs the same way whether
 * or not `?theme=` resolves.
 */
function usePageTheme(theme: string | undefined): void {
    const page = theme ? pageThemeOf(getTheme(theme)) : null;
    if (page) registerTheme(extendTheme(page.base, { name: page.name, variant: page.variant, colors: page.colors }));
    useFocusEffect(() => {
        if (!page) return undefined;
        const prevName = themeController.name;
        const prevFollowing = themeController.followingSystem;
        themeController.set(page.name);
        return () => {
            if (prevFollowing) themeController.followSystem();
            else themeController.set(prevName);
        };
    });
}

function knownScope(scope: string): scope is GalleryScopeId {
    return Object.prototype.hasOwnProperty.call(GALLERY_SCOPES, scope);
}

const Frame = component<Define.Prop<'theme', string | undefined, false> & Define.Slot<'default'>>(({ props, slots }) => {
    return () => (
        <ZeroRoot initial={props.theme ?? 'light'}>
            <ScrollView flex={1}>
                <Col padding={FRAME_PADDING} gap={4}>{slots.default?.()}</Col>
            </ScrollView>
        </ZeroRoot>
    );
});

export const ZeroGalleryIndex = component(() => {
    const nav = useNav();
    return () => (
        <Frame>
            <Screen title="Zero Gallery" />
            <text class="zg-note">
                Every axis × forced state, one screen per section. Deep link: showcase://zero-gallery/&lt;scope&gt;/&lt;section&gt;
            </text>
            {(Object.keys(GALLERY_SCOPES) as GalleryScopeId[]).map((scope) => (
                <view key={scope} class="zg-index-row">
                    <text class="zg-title" bindtap={() => nav.push('zeroGalleryScope', { scope })}>{GALLERY_SCOPES[scope].title}</text>
                    <view style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '8px' }}>
                        {gallerySections(scope).map((section) => (
                            <text
                                key={section}
                                class="zg-chip"
                                bindtap={() => nav.push('zeroGallerySection', { scope, section })}
                            >
                                {section}
                            </text>
                        ))}
                    </view>
                </view>
            ))}
        </Frame>
    );
});

export const ZeroGalleryScope = component(() => {
    const { scope } = useParams('zeroGalleryScope');
    const search = useSearch('zeroGalleryScope');
    usePageTheme(search.theme);
    return () => (
        <Frame theme={search.theme}>
            <Screen title={`Zero Gallery · ${scope}`} />
            {knownScope(scope)
                ? gallerySections(scope).map((section) => <Section key={section} scope={scope} section={section} />)
                : <text class="zg-error">{`Unknown scope "${scope}"`}</text>}
        </Frame>
    );
});

export const ZeroGallerySection = component(() => {
    const { scope, section } = useParams('zeroGallerySection');
    const search = useSearch('zeroGallerySection');
    usePageTheme(search.theme);
    return () => (
        <Frame theme={search.theme}>
            <Screen title={`${scope} · ${section}`} headerShown={false} />
            {knownScope(scope)
                ? <Section scope={scope} section={section} />
                : <text class="zg-error">{`Unknown scope "${scope}"`}</text>}
        </Frame>
    );
});
