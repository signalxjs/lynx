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
import { Avatar, AvatarGroup, Skeleton, Spinner } from '@sigx/lynx-zero';
import { Breadcrumbs, Navbar } from '@sigx/lynx-zero';
import { Menu, NavList } from '@sigx/lynx-zero';
import { Pagination, Steps } from '@sigx/lynx-zero';
import { TreeView } from '@sigx/lynx-zero';
import { Chat, ChatLog, FileUpload } from '@sigx/lynx-zero';
import type { FileRejection, FileUploadFile } from '@sigx/lynx-zero';
import { FilePicker } from '@sigx/lynx-file-picker';
import { Drawer, Tooltip } from '@sigx/lynx-zero';
import type { DrawerCloseDetail, DrawerMeasure, DrawerPlacement } from '@sigx/lynx-zero';
import { Carousel, Table } from '@sigx/lynx-zero';
import type { TableColumn, TableSort, TableSortDirection } from '@sigx/lynx-zero';
import { Combobox } from '@sigx/lynx-zero';
import type { ToastItem, ToastStatus } from '@sigx/lynx-zero';
import { ForceStates } from '@sigx/lynx-zero/testing';
import { pageThemeOf } from './page-theme.js';
import type { GalleryAxis, GalleryScope, GalleryScopeId, GalleryState } from './scopes.js';
import { CHAT_CELL_WIDTH, CHAT_LOG_BOX, FILE_UPLOAD_WIDTH } from './scopes.js';
import {
    BLOCK_GAP, CELL_PAD, COLORS, FRAME_PADDING, GALLERY_SCOPES, LABEL_GAP, LABEL_WIDTH, LINE_GAP, SIZES,
    NAV_CELL_WIDTH, NAVBAR_CELL_WIDTH, STEPS_RAIL_WIDTH, TEXT_FIELD_WIDTH, gallerySections, matrixOf, parseSection,
    CAROUSEL_CELL_WIDTH, CAROUSEL_SLIDE_HEIGHT, TABLE_CELL_WIDTH,
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

/** A navbar cell: the fluid bar in a fixed box. */
const NAVBAR_BOX = { width: `${NAVBAR_CELL_WIDTH}px` };

/** The navbar `squeeze` extra's box: narrower than the bar's content (#1274). */
const SQUEEZE_BOX = { width: '140px', borderWidth: '1px', borderStyle: 'dashed', borderColor: '#9ca3af' };

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

/**
 * The avatar cells' sources (W3C #1237): a bundled 16×16 raster (a raster
 * data URI decodes on both engines; loads at once), a URL that fails, and
 * one that never answers — a non-routable address, so the image stays
 * `loading` for the whole shot.
 */
const AVATAR_SRC: Record<string, string> = {
    face: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAALUlEQVR4nGOIqflFEmKgu4Zf15aiIapqwFSNqYfOGmjvaVpGHC7vYrptEGoAAMPcDz9o76SlAAAAAElFTkSuQmCC',
    broken: 'https://invalid.invalid/avatar.png',
    pending: 'https://10.255.255.1/avatar.png',
};

/** An in-place toast's data carrying a promise status (#1196). */
const statusToast = (status: ToastStatus, title: string): ToastItem => ({ id: 0, open: true, title, status });

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
            // #1255: the forced ring of a full-width field paints on all four
            // sides inside the panel's scroll body.
            'field-focus': () => (
                <Dialog.Root defaultOpen dismissible={false}>
                    <Dialog.Trigger><text>Open dialog</text></Dialog.Trigger>
                    <Dialog.Popup>
                        <Dialog.Title>Focus ring</Dialog.Title>
                        <Dialog.Description>The ring paints all the way round.</Dialog.Description>
                        <Field.Root>
                            <Field.Label>Name</Field.Label>
                            <ForceStates flags={{ 'focus-visible': true }} parts={['control']}>
                                <Input.Root defaultValue="Ada Lovelace" label="Name">
                                    <Input.Control><Input.Input /></Input.Control>
                                </Input.Root>
                            </ForceStates>
                        </Field.Root>
                        <Dialog.Footer>
                            <Dialog.Close><text>Close</text></Dialog.Close>
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
            // Promise toasts (#1196): the mark beside the text — neutral in
            // every status, then role colours and the size ends.
            indicator: () => (
                <Col gap={10}>
                    {([
                        ['loading', 'Uploading…', undefined, undefined],
                        ['complete', 'Uploaded', undefined, undefined],
                        ['error', 'Upload failed', undefined, undefined],
                        ['loading', 'Syncing…', 'primary', undefined],
                        ['complete', 'Saved', 'success', 'lg'],
                        ['error', 'Offline', 'error', 'xs'],
                    ] as const).map(([status, title, color, size]) => (
                        <Toast.Root key={`${status}-${title}`} toast={statusToast(status, title)} color={color} size={size}>
                            <Toast.Indicator />
                            <Toast.Title>{title}</Toast.Title>
                            <Toast.Description>{`status: ${status}`}</Toast.Description>
                            <Toast.Close />
                        </Toast.Root>
                    ))}
                </Col>
            ),
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
    // ── Wave 3, display (W3C #1237) ──
    avatar: {
        cell: (c) => {
            const src = str(c.props['src']);
            return (
                <Avatar.Root color={c.color} size={c.size}>
                    {src ? <Avatar.Image src={AVATAR_SRC[src]} alt="Ada Lovelace" /> : null}
                    <Avatar.Fallback><text>AL</text></Avatar.Fallback>
                </Avatar.Root>
            );
        },
        extras: {
            // The shape axis at md and xl, image and fallback.
            shape: () => (
                <Col gap={14}>
                    {(['circle', 'square', 'rounded'] as const).map((shape) => (
                        <Row key={shape} gap={14} align="center">
                            <text class="zg-label" style={{ width: '56px' }}>{shape}</text>
                            <Avatar.Root shape={shape}><Avatar.Image src={AVATAR_SRC['face']!} alt="Ada" /><Avatar.Fallback><text>AL</text></Avatar.Fallback></Avatar.Root>
                            <Avatar.Root shape={shape}><Avatar.Fallback><text>AL</text></Avatar.Fallback></Avatar.Root>
                            <Avatar.Root shape={shape} size="xl"><Avatar.Image src={AVATAR_SRC['face']!} alt="Ada" /><Avatar.Fallback><text>AL</text></Avatar.Fallback></Avatar.Root>
                            <Avatar.Root shape={shape} size="xl" color="accent"><Avatar.Fallback><text>AL</text></Avatar.Fallback></Avatar.Root>
                        </Row>
                    ))}
                </Col>
            ),
        },
    },
    'avatar-group': {
        cell: (c) => (
            <AvatarGroup.Root label="Project members" color={c.color} size={c.size}>
                {['AL', 'GH', 'KJ'].map((initials) => (
                    <Avatar.Root key={initials}><Avatar.Fallback><text>{initials}</text></Avatar.Fallback></Avatar.Root>
                ))}
                <AvatarGroup.Overflow count={Number(c.props['count'] ?? 0)} />
            </AvatarGroup.Root>
        ),
        extras: {
            // A loaded face, a broken one (its fallback), an avatar that
            // sets its own size inside an sm group, then a 12-member group.
            mixed: () => (
                <Col gap={18}>
                    <AvatarGroup.Root label="Reviewers" size="sm">
                        <Avatar.Root><Avatar.Image src={AVATAR_SRC['face']!} alt="Ada" /><Avatar.Fallback><text>AL</text></Avatar.Fallback></Avatar.Root>
                        <Avatar.Root><Avatar.Image src={AVATAR_SRC['broken']!} alt="Grace" /><Avatar.Fallback><text>GH</text></Avatar.Fallback></Avatar.Root>
                        <Avatar.Root size="lg" color="warning"><Avatar.Fallback><text>KJ</text></Avatar.Fallback></Avatar.Root>
                        <AvatarGroup.Overflow count={2} />
                    </AvatarGroup.Root>
                    <AvatarGroup.Root label="Team" size="lg" color="secondary">
                        {['A', 'B', 'C', 'D', 'E'].map((initials) => (
                            <Avatar.Root key={initials}><Avatar.Fallback><text>{initials}</text></Avatar.Fallback></Avatar.Root>
                        ))}
                        <AvatarGroup.Overflow count={7} />
                    </AvatarGroup.Root>
                </Col>
            ),
        },
    },
    skeleton: {
        cell: (c) => (
            <view style={{ width: '96px' }}>
                <Skeleton.Root color={c.color} size={c.size} defaultLoading={bool(c.props['loading'])}>
                    <text style={{ fontSize: '14px' }}>Headline text</text>
                </Skeleton.Root>
            </view>
        ),
        extras: {
            // What an app draws with it: a text line, a media block, an
            // avatar circle — loading beside loaded.
            shapes: () => (
                <Col gap={16}>
                    {[true, false].map((loading) => (
                        <Row key={String(loading)} gap={12} align="center">
                            <Skeleton.Root defaultLoading={loading} size="xs">
                                <view style={{ width: '40px', height: '40px' }}><text>AL</text></view>
                            </Skeleton.Root>
                            <Col gap={6}>
                                <Skeleton.Root defaultLoading={loading} size="sm"><text>Ada Lovelace</text></Skeleton.Root>
                                <Skeleton.Root defaultLoading={loading} size="sm" color="primary"><text>Analyst, 1843</text></Skeleton.Root>
                            </Col>
                            <Skeleton.Root defaultLoading={loading} size="lg">
                                <view style={{ width: '120px', height: '64px' }}><text>Media block</text></view>
                            </Skeleton.Root>
                        </Row>
                    ))}
                </Col>
            ),
        },
    },
    spinner: {
        cell: (c) => <Spinner color={c.color} size={c.size} decorative={bool(c.props['decorative'])} />,
        extras: {
            // The decorative spinner beside the words that say it, at three sizes.
            inline: () => (
                <Col gap={14}>
                    {(['xs', 'md', 'xl'] as const).map((size) => (
                        <Row key={size} gap={8} align="center">
                            <Spinner decorative size={size} />
                            <text>{`Saving (${size})…`}</text>
                        </Row>
                    ))}
                    <Row gap={8} align="center">
                        <Spinner label="Uploading photos" color="accent" />
                        <text>labelled: "Uploading photos"</text>
                    </Row>
                </Col>
            ),
        },
    },
    // ── Wave 4, navigation (W4B #1257) ───────────────────────────────────
    navbar: {
        cell: (c) => (
            <view style={NAVBAR_BOX}>
                <Navbar.Root color={c.color} size={c.size}>
                    <Navbar.Start><text>Acme</text></Navbar.Start>
                    {bool(c.props['center']) ? <Navbar.Center><text>Inbox</text></Navbar.Center> : null}
                    <Navbar.End><text>Me</text></Navbar.End>
                </Navbar.Root>
            </view>
        ),
        extras: {
            // What an app builds: brand + action, a centred title between
            // icon buttons, a coloured bar with ghost actions, a small bar.
            compose: () => (
                <Col gap={14}>
                    <Navbar.Root>
                        <Navbar.Start><text style={{ fontWeight: '700' }}>Acme</text></Navbar.Start>
                        <Navbar.End><Button color="primary" size="sm"><text>Sign in</text></Button></Navbar.End>
                    </Navbar.Root>
                    <Navbar.Root color="neutral">
                        <Navbar.Start><Button variant="ghost" size="sm" label="Menu"><text>☰</text></Button></Navbar.Start>
                        <Navbar.Center><text style={{ fontWeight: '700' }}>Inbox</text></Navbar.Center>
                        <Navbar.End><Button variant="ghost" size="sm" label="Search"><text>⌕</text></Button></Navbar.End>
                    </Navbar.Root>
                    <Navbar.Root color="primary">
                        <Navbar.Start><text>Projects</text></Navbar.Start>
                        <Navbar.End>
                            <Button variant="ghost" size="sm"><text>New</text></Button>
                            <Button variant="ghost" size="sm"><text>Share</text></Button>
                        </Navbar.End>
                    </Navbar.Root>
                    <Navbar.Root size="xs" color="accent">
                        <Navbar.Start><text>xs bar</text></Navbar.Start>
                        <Navbar.End><text>end</text></Navbar.End>
                    </Navbar.Root>
                    <Navbar.Root>
                        <Navbar.Center><text>Center only</text></Navbar.Center>
                    </Navbar.Root>
                </Col>
            ),
            // Bars narrower than their content (#1274): no section text
            // breaks mid-word. Each section keeps its words whole and the
            // row overflows its dashed box, as daisy's does. The last bar is
            // wide enough, with unequal ends: the ends share the slack.
            squeeze: () => (
                <Col gap={14}>
                    <view style={SQUEEZE_BOX}>
                        <Navbar.Root size="xl">
                            <Navbar.Start><text>Acme</text></Navbar.Start>
                            <Navbar.Center><text>Inbox</text></Navbar.Center>
                            <Navbar.End><text>Me</text></Navbar.End>
                        </Navbar.Root>
                    </view>
                    <view style={SQUEEZE_BOX}>
                        <Navbar.Root size="lg" color="primary">
                            <Navbar.Start><text>Dashboard</text></Navbar.Start>
                            <Navbar.End><text>Settings</text></Navbar.End>
                        </Navbar.Root>
                    </view>
                    <Navbar.Root color="neutral">
                        <Navbar.Start><text>‹ Back</text></Navbar.Start>
                        <Navbar.Center><text style={{ fontWeight: '700' }}>Title</text></Navbar.Center>
                        <Navbar.End><text>⌕</text></Navbar.End>
                    </Navbar.Root>
                </Col>
            ),
        },
    },
    breadcrumbs: {
        cell: (c) => (
            <BreadcrumbTrail
                color={c.color}
                size={c.size}
                labels={bool(c.props['collapsed']) ? ['Home', 'Zero', 'Docs', 'Guide', 'Kit'] : ['Home', 'Docs', 'Kit']}
                maxItems={bool(c.props['collapsed']) ? 3 : undefined}
            />
        ),
        extras: {
            // Live: tap … to expand each trail.
            collapse: () => (
                <Col gap={16}>
                    <text>maxItems 3 (1 before, 1 after) — tap … to expand</text>
                    <BreadcrumbTrail labels={['Home', 'Library', 'Zero', 'Anatomy', 'Page']} maxItems={3} />
                    <text>2 before, 2 after, color primary</text>
                    <BreadcrumbTrail
                        color="primary"
                        labels={['Home', 'Library', 'Zero', 'Kit', 'Anatomy', 'Page']}
                        maxItems={4}
                        before={2}
                        after={2}
                    />
                    <text>custom separator ›, size lg</text>
                    <BreadcrumbTrail size="lg" labels={['Home', 'Docs', 'Page']} separator="›" />
                    <text>long trail wraps</text>
                    <BreadcrumbTrail labels={['Home', 'Documents', 'Add Document', 'Settings', 'Notifications', 'Current page']} />
                </Col>
            ),
        },
    },
    menu: {
        cell: (c) => (
            <Menu.Root color={c.color} size={c.size}>
                <Menu.Trigger disabled={bool(c.props['disabled'])}><text>Menu</text></Menu.Trigger>
                <Menu.Popup><Menu.Item value="never"><text>Never opened</text></Menu.Item></Menu.Popup>
            </Menu.Root>
        ),
        extras: {
            open: () => (
                <Menu.Root defaultOpen color="primary">
                    <Menu.Trigger><text>Actions</text></Menu.Trigger>
                    <Menu.Popup>
                        <Menu.Item value="rename"><text>Rename</text><Menu.Shortcut>⌘R</Menu.Shortcut></Menu.Item>
                        <Menu.Item value="duplicate"><text>Duplicate</text><Menu.Shortcut>⌘D</Menu.Shortcut></Menu.Item>
                        <Menu.Item value="archive" disabled><text>Archive (disabled)</text></Menu.Item>
                        <Menu.Separator />
                        <Menu.Group>
                            <Menu.GroupLabel>Danger zone</Menu.GroupLabel>
                            <Menu.Item value="delete"><text>Delete…</text></Menu.Item>
                        </Menu.Group>
                    </Menu.Popup>
                </Menu.Root>
            ),
            'open-states': () => (
                <Menu.Root defaultOpen closeOnSelect={false}>
                    <Menu.Trigger><text>View</text></Menu.Trigger>
                    <Menu.Popup>
                        <ForceStates flags={{ highlighted: true, pressed: true }}>
                            <Menu.Item value="held"><text>Held row</text></Menu.Item>
                        </ForceStates>
                        <Menu.Item value="rest"><text>Resting row</text></Menu.Item>
                        <Menu.Separator />
                        <Menu.CheckboxItem value="on" defaultChecked><text>Checked</text></Menu.CheckboxItem>
                        <Menu.CheckboxItem value="off"><text>Unchecked</text></Menu.CheckboxItem>
                        <Menu.CheckboxItem value="dis" defaultChecked disabled><text>Checked, disabled</text></Menu.CheckboxItem>
                        <Menu.Separator />
                        <Menu.RadioGroup defaultValue="name">
                            <Menu.GroupLabel>Sort by</Menu.GroupLabel>
                            <Menu.RadioItem value="name"><text>Name</text></Menu.RadioItem>
                            <Menu.RadioItem value="date"><text>Date</text></Menu.RadioItem>
                        </Menu.RadioGroup>
                    </Menu.Popup>
                </Menu.Root>
            ),
            sub: () => (
                <Menu.Root defaultOpen>
                    <Menu.Trigger><text>File</text></Menu.Trigger>
                    <Menu.Popup>
                        <Menu.Item value="new"><text>New</text></Menu.Item>
                        <Menu.Sub defaultOpen>
                            <Menu.SubTrigger><text>Share</text></Menu.SubTrigger>
                            <Menu.SubPopup>
                                <Menu.Item value="email"><text>Email</text></Menu.Item>
                                <Menu.Item value="link"><text>Copy link</text></Menu.Item>
                                <Menu.Item value="airdrop" disabled><text>AirDrop</text></Menu.Item>
                            </Menu.SubPopup>
                        </Menu.Sub>
                        <Menu.Sub>
                            <Menu.SubTrigger><text>Export</text></Menu.SubTrigger>
                            <Menu.SubPopup><Menu.Item value="pdf"><text>PDF</text></Menu.Item></Menu.SubPopup>
                        </Menu.Sub>
                        <Menu.Item value="close"><text>Close</text></Menu.Item>
                    </Menu.Popup>
                </Menu.Root>
            ),
            // The sub-trigger's states in one popup: held (forced highlighted
            // + pressed), disabled, and an open two-level chain (Export ›
            // Image) — a nested submenu opens beside its parent, which stays
            // open. Live: tap `Data` and `Image` closes (siblings are
            // exclusive per level, #1273); tap `Held` and `Export` closes.
            'sub-states': () => (
                <Menu.Root defaultOpen>
                    <Menu.Trigger><text>Edit</text></Menu.Trigger>
                    <Menu.Popup>
                        <ForceStates flags={{ highlighted: true, pressed: true }}>
                            <Menu.Sub>
                                <Menu.SubTrigger><text>Held</text></Menu.SubTrigger>
                                <Menu.SubPopup><Menu.Item value="held-a"><text>A</text></Menu.Item></Menu.SubPopup>
                            </Menu.Sub>
                        </ForceStates>
                        <Menu.Sub>
                            <Menu.SubTrigger disabled><text>Disabled</text></Menu.SubTrigger>
                            <Menu.SubPopup><Menu.Item value="never"><text>Never</text></Menu.Item></Menu.SubPopup>
                        </Menu.Sub>
                        <Menu.Sub defaultOpen>
                            <Menu.SubTrigger><text>Export</text></Menu.SubTrigger>
                            <Menu.SubPopup>
                                <Menu.Item value="pdf"><text>PDF</text></Menu.Item>
                                <Menu.Sub defaultOpen>
                                    <Menu.SubTrigger><text>Image</text></Menu.SubTrigger>
                                    <Menu.SubPopup>
                                        <Menu.Item value="png"><text>PNG</text></Menu.Item>
                                        <Menu.Item value="jpeg"><text>JPEG</text></Menu.Item>
                                    </Menu.SubPopup>
                                </Menu.Sub>
                                <Menu.Sub>
                                    <Menu.SubTrigger><text>Data</text></Menu.SubTrigger>
                                    <Menu.SubPopup><Menu.Item value="csv"><text>CSV</text></Menu.Item></Menu.SubPopup>
                                </Menu.Sub>
                            </Menu.SubPopup>
                        </Menu.Sub>
                    </Menu.Popup>
                </Menu.Root>
            ),
        },
    },
    'nav-list': {
        cell: (c) => (
            <view style={{ width: `${NAV_CELL_WIDTH}px` }}>
                <NavList.Root color={c.color} size={c.size}>
                    <NavList.List>
                        <NavList.Item>
                            <NavList.Link current={bool(c.props['current'])}>
                                {bool(c.props['plain']) ? null : <NavList.Icon><text>✉</text></NavList.Icon>}
                                <text>Inbox</text>
                                {bool(c.props['plain']) ? null : <NavList.Meta><text>12</text></NavList.Meta>}
                            </NavList.Link>
                        </NavList.Item>
                    </NavList.List>
                </NavList.Root>
            </view>
        ),
        extras: {
            sidebar: () => <NavSidebar />,
        },
    },
    pagination: {
        cell: (c) => (
            <Pagination.Root count={3} defaultPage={2} color={c.color} size={c.size} disabled={bool(c.props['disabled'])} />
        ),
        extras: {
            // The window as it walks: the bounds (a dimmed trigger), both
            // ellipses, the edge triggers, and the sibling/boundary counts.
            window: () => (
                <Col gap={14}>
                    <text class="zg-label">page 1 of 20 · prev disabled</text>
                    <Pagination.Root count={20} defaultPage={1} size="sm" />
                    <text class="zg-label">page 10 of 20 · both ellipses</text>
                    <Pagination.Root count={20} defaultPage={10} size="sm" color="secondary" />
                    <text class="zg-label">page 20 of 20 · next disabled</text>
                    <Pagination.Root count={20} defaultPage={20} size="sm" color="accent" />
                    <text class="zg-label">withEdges « ‹ … › » · page 10</text>
                    <Pagination.Root count={20} defaultPage={10} size="xs" withEdges />
                    <text class="zg-label">siblingCount 0 · boundaryCount 2</text>
                    <Pagination.Root count={20} defaultPage={10} size="xs" siblingCount={0} boundaryCount={2} color="neutral" />
                    <text class="zg-label">withEdges held / focus-visible</text>
                    <ForceStates flags={{ pressed: true }}>
                        <Pagination.Root count={4} defaultPage={2} size="xs" withEdges color="success" />
                    </ForceStates>
                    <ForceStates flags={{ 'focus-visible': true }}>
                        <Pagination.Root count={4} defaultPage={2} size="xs" withEdges color="error" />
                    </ForceStates>
                </Col>
            ),
        },
    },
    steps: {
        cell: (c) => (
            <view style={{ width: `${STEPS_RAIL_WIDTH}px` }}>
                <Steps.Root
                    defaultStep={str(c.props['step']) ?? 'ship'}
                    color={c.color}
                    size={c.size}
                    disabled={bool(c.props['disabled'])}
                    linear={bool(c.props['linear'])}
                >
                    {STEP_NAMES.map((name, index) => (
                        <Steps.Item
                            key={name}
                            value={name.toLowerCase()}
                            label={name}
                            invalid={index === 2 && bool(c.props['invalid'])}
                        >
                            <Steps.Indicator><text>{String(index + 1)}</text></Steps.Indicator>
                            <Steps.Title>{name}</Steps.Title>
                            {index < STEP_NAMES.length - 1 ? <Steps.Separator /> : null}
                        </Steps.Item>
                    ))}
                </Steps.Root>
            </view>
        ),
        extras: {
            // A vertical rail: disc, then title over description, each disc
            // joined to the next down the side.
            vertical: () => (
                <Row gap={12} align="flex-start">
                    {(['md', 'xs'] as const).map((size) => (
                        <view key={size} style={{ width: '180px' }}>
                            <Steps.Root orientation="vertical" defaultStep="ship" size={size}>
                                {STEP_NAMES.map((name, index) => (
                                    <Steps.Item key={name} value={name.toLowerCase()} label={name} invalid={size === 'xs' && index === 2}>
                                        <Steps.Indicator><text>{String(index + 1)}</text></Steps.Indicator>
                                        <view style={{ display: 'flex', flexDirection: 'column' }}>
                                            <Steps.Title>{name}</Steps.Title>
                                            <Steps.Description>{STEP_NOTES[index]!}</Steps.Description>
                                        </view>
                                        {index < STEP_NAMES.length - 1 ? <Steps.Separator /> : null}
                                    </Steps.Item>
                                ))}
                            </Steps.Root>
                        </view>
                    ))}
                </Row>
            ),
            // The wizard half: the active step's panel, Back (dimmed at the
            // first step) and Next, under a linear rail — live, so a tap
            // walks it. Below it, the held and focus-visible triggers.
            wizard: () => (
                <Col gap={20}>
                    <StepsWizard />
                    <ForceStates flags={{ pressed: true }} parts={['prev-trigger', 'next-trigger']}>
                        <StepsWizard start="ship" />
                    </ForceStates>
                    <ForceStates flags={{ 'focus-visible': true }} parts={['next-trigger']}>
                        <StepsWizard start="pay" />
                    </ForceStates>
                </Col>
            ),
            // One colour per step (the item re-carries the axis): complete
            // steps in their own tint, the current one filled.
            colors: () => (
                <Col gap={16}>
                    {(['pay', 'ship'] as const).map((step) => (
                        <view key={step} style={{ width: '360px' }}>
                            <Steps.Root defaultStep={step}>
                                {(['success', 'info', 'warning', 'error'] as const).map((color, index) => (
                                    <Steps.Item key={color} value={['cart', 'ship', 'pay', 'done'][index]!} color={color} label={color}>
                                        <Steps.Indicator><text>{String(index + 1)}</text></Steps.Indicator>
                                        <Steps.Title>{color}</Steps.Title>
                                        {index < 3 ? <Steps.Separator /> : null}
                                    </Steps.Item>
                                ))}
                            </Steps.Root>
                        </view>
                    ))}
                    <view style={{ width: '360px' }}>
                        <Steps.Root defaultStep="done" color="secondary">
                            {(['cart', 'ship', 'pay', 'done'] as const).map((value, index) => (
                                <Steps.Item key={value} value={value} label={value} color={index === 1 ? 'error' : undefined} invalid={index === 1}>
                                    <Steps.Indicator><text>{index === 1 ? '!' : String(index + 1)}</text></Steps.Indicator>
                                    <Steps.Title>{value}</Steps.Title>
                                    {index < 3 ? <Steps.Separator /> : null}
                                </Steps.Item>
                            ))}
                        </Steps.Root>
                    </view>
                </Col>
            ),
        },
    },
    'tree-view': {
        cell: (c) => (
            <TreeCell
                color={c.color}
                size={c.size}
                selected={str(c.props['value']) ?? 'a'}
                closed={bool(c.props['closed'])}
                loading={bool(c.props['loading'])}
                nodeDisabled={bool(c.props['nodeDisabled'])}
                disabled={bool(c.props['disabled'])}
            />
        ),
        extras: {
            checkable: () => (
                <Col gap={16}>
                    <text class="zg-note">a checked · Dir mixed · c disabled · All checked (collapsed) · right: boxes on selected rows</text>
                    <Row gap={12} align="flex-start">
                        <view style={TREE_BOX}><CheckTree /></view>
                        <view style={TREE_BOX}><CheckTree selected={['a', 'dir']} color="secondary" /></view>
                    </Row>
                    <text class="zg-note">held (all rows) · focus (all rows)</text>
                    <Row gap={12} align="flex-start">
                        <view style={TREE_BOX}>
                            <ForceStates flags={{ pressed: true }}><CheckTree selected={['a']} /></ForceStates>
                        </view>
                        <view style={TREE_BOX}>
                            <ForceStates flags={{ 'focus-visible': true }}><CheckTree /></ForceStates>
                        </view>
                    </Row>
                    <text class="zg-note">root disabled</text>
                    <view style={TREE_BOX}><CheckTree disabled /></view>
                </Col>
            ),
            multiple: () => (
                <Col gap={16}>
                    {(['primary', 'accent', 'neutral'] as const).map((color) => (
                        <TreeView.Root key={color} multiple color={color} defaultValue={['a', 'b']} defaultExpandedValues={['dir']}>
                            <TreeView.Label>{`multiple · ${color}`}</TreeView.Label>
                            <TreeView.Tree>
                                <TreeView.Branch value="dir">
                                    <TreeView.BranchTrigger><TreeView.BranchIndicator /><text>Dir</text></TreeView.BranchTrigger>
                                    <TreeView.BranchContent>
                                        <TreeView.Item value="a"><text>a (selected)</text></TreeView.Item>
                                        <TreeView.Item value="c"><text>c</text></TreeView.Item>
                                    </TreeView.BranchContent>
                                </TreeView.Branch>
                                <TreeView.Item value="b"><text>b (selected)</text></TreeView.Item>
                            </TreeView.Tree>
                        </TreeView.Root>
                    ))}
                </Col>
            ),
            indicator: () => (
                <Col gap={16}>
                    <text class="zg-note">expandOnClick=false: the row selects, the › toggles</text>
                    <TreeView.Root expandOnClick={false} defaultValue="src" defaultExpandedValues={['src', 'lib']}>
                        <TreeView.Label>Files</TreeView.Label>
                        <TreeView.Tree>
                            <TreeView.Branch value="src">
                                <TreeView.BranchTrigger><TreeView.BranchIndicator /><text>src</text></TreeView.BranchTrigger>
                                <TreeView.BranchContent>
                                    <TreeView.Branch value="lib">
                                        <TreeView.BranchTrigger><TreeView.BranchIndicator /><text>lib</text></TreeView.BranchTrigger>
                                        <TreeView.BranchContent>
                                            <TreeView.Item value="lib/a.ts"><text>a.ts</text></TreeView.Item>
                                            <TreeView.Item value="lib/b.ts" disabled><text>b.ts (disabled)</text></TreeView.Item>
                                        </TreeView.BranchContent>
                                    </TreeView.Branch>
                                    <TreeView.Branch value="remote" loading>
                                        <TreeView.BranchTrigger><TreeView.BranchIndicator /><text>remote (loading)</text></TreeView.BranchTrigger>
                                        <TreeView.BranchContent />
                                    </TreeView.Branch>
                                    <TreeView.Branch value="vendor" disabled>
                                        <TreeView.BranchTrigger><TreeView.BranchIndicator /><text>vendor (disabled)</text></TreeView.BranchTrigger>
                                        <TreeView.BranchContent>
                                            <TreeView.Item value="vendor/x.ts"><text>x.ts</text></TreeView.Item>
                                        </TreeView.BranchContent>
                                    </TreeView.Branch>
                                    <TreeView.Item value="index.ts"><text>index.ts</text></TreeView.Item>
                                </TreeView.BranchContent>
                            </TreeView.Branch>
                            <TreeView.Item value="README.md"><text>README.md</text></TreeView.Item>
                        </TreeView.Tree>
                    </TreeView.Root>
                </Col>
            ),
            // #1292: select rows by TAPPING — the tapped row's label and
            // chevron take the accent's -content ink live, not only at mount.
            'live-select': () => (
                <Col gap={16}>
                    {(['primary', 'secondary'] as const).map((color) => (
                        <Col gap={6}>
                            <text class="zg-note">{`${color} · nothing selected at mount — tap rows`}</text>
                            <TreeView.Root color={color} defaultExpandedValues={['src']}>
                                <TreeView.Tree>
                                    <TreeView.Branch value="src">
                                        <TreeView.BranchTrigger><TreeView.BranchIndicator /><text>src</text></TreeView.BranchTrigger>
                                        <TreeView.BranchContent>
                                            <TreeView.Item value="src/index.ts"><text>index.ts</text></TreeView.Item>
                                            <TreeView.Item value="src/util.ts"><text>util.ts</text></TreeView.Item>
                                        </TreeView.BranchContent>
                                    </TreeView.Branch>
                                    <TreeView.Item value="README.md"><text>README.md</text></TreeView.Item>
                                </TreeView.Tree>
                            </TreeView.Root>
                        </Col>
                    ))}
                    <text class="zg-note">multiple + checkable · tap rows and boxes</text>
                    <TreeView.Root multiple checkable defaultExpandedValues={['docs']}>
                        <TreeView.Tree>
                            <TreeView.Branch value="docs">
                                <TreeView.BranchTrigger><TreeView.BranchIndicator /><TreeView.NodeCheckbox /><text>docs</text></TreeView.BranchTrigger>
                                <TreeView.BranchContent>
                                    <TreeView.Item value="docs/a.md"><TreeView.NodeCheckbox /><text>a.md</text></TreeView.Item>
                                    <TreeView.Item value="docs/b.md"><TreeView.NodeCheckbox /><text>b.md</text></TreeView.Item>
                                </TreeView.BranchContent>
                            </TreeView.Branch>
                        </TreeView.Tree>
                    </TreeView.Root>
                </Col>
            ),
        },
    },
    drawer: {
        cell: (c) => (
            <Drawer.Root color={c.color} size={c.size}>
                <Drawer.Trigger disabled={bool(c.props['disabled'])}><text>Open</text></Drawer.Trigger>
                <Drawer.Panel><Drawer.Title>Never opened</Drawer.Title></Drawer.Panel>
            </Drawer.Root>
        ),
        extras: {
            start: () => <DrawerOpen placement="start" />,
            end: () => <DrawerOpen placement="end" />,
            top: () => <DrawerOpen placement="top" />,
            bottom: () => <DrawerOpen placement="bottom" />,
            'close-states': () => (
                <Drawer.Root defaultOpen dismissible={false} color="primary">
                    <Drawer.Trigger><text>Open drawer</text></Drawer.Trigger>
                    <Drawer.Panel>
                        <Drawer.Title>Close states</Drawer.Title>
                        <Col gap={12} align="flex-start">
                            <text class="zg-note">held (forced pressed)</text>
                            <ForceStates flags={{ pressed: true }}><Drawer.Close><text>Close</text></Drawer.Close></ForceStates>
                            <text class="zg-note">focus-visible (forced)</text>
                            <ForceStates flags={{ 'focus-visible': true }}><Drawer.Close><text>Close</text></Drawer.Close></ForceStates>
                            <text class="zg-note">disabled</text>
                            <Drawer.Close disabled><text>Close</text></Drawer.Close>
                        </Col>
                    </Drawer.Panel>
                </Drawer.Root>
            ),
            measure: () => <DrawerOpen placement="start" measure={240} />,
            // Live dismiss: open at mount and DISMISSIBLE — a tap on the dim
            // closes it, and so does the system back (Android back button /
            // iOS edge swipe). The trigger reopens it; the note under it
            // shows the last close reason.
            dismissible: () => <DrawerDismissible />,
            // Focus the field: the sheet's content lifts above the keyboard.
            keyboard: () => (
                <Drawer.Root defaultOpen dismissible={false} placement="bottom">
                    <Drawer.Trigger><text>Open drawer</text></Drawer.Trigger>
                    <Drawer.Panel>
                        <Drawer.Title>Leave a note</Drawer.Title>
                        <Field.Root>
                            <Field.Label>Note</Field.Label>
                            <Input.Root defaultValue="" label="Note">
                                <Input.Control><Input.Input /></Input.Control>
                            </Input.Root>
                        </Field.Root>
                        <Row gap={8} justify="flex-end">
                            <Drawer.Close><text>Send</text></Drawer.Close>
                        </Row>
                    </Drawer.Panel>
                </Drawer.Root>
            ),
        },
    },
    tooltip: {
        cell: (c) => (
            <Tooltip.Root color={c.color} size={c.size}>
                <Tooltip.Trigger disabled={bool(c.props['disabled'])}><text>Tip</text></Tooltip.Trigger>
                <Tooltip.Popup><text>Never opened</text></Tooltip.Popup>
            </Tooltip.Root>
        ),
        extras: {
            // One per side, open at mount, arrows at the trigger's centre.
            // The side placements each get a row of their own, the trigger
            // on the far side of it (#1293): a `left` trigger needs the room
            // to its left for its bubble. Side by side in one centred row,
            // neither had it, both flipped inward and overlapped.
            open: () => (
                <Col gap={72} padding={{ top: 48, left: 16, right: 16 }}>
                    <Row justify="center"><TipOpen placement="top" color="primary" /></Row>
                    <Row justify="center"><TipOpen placement="bottom" color="accent" /></Row>
                    <Row justify="flex-end"><TipOpen placement="left" /></Row>
                    <Row justify="flex-start"><TipOpen placement="right" /></Row>
                </Col>
            ),
            // Triggers against the screen edges: the popup clamps inside the
            // frame, the arrow keeps pointing at the trigger.
            edge: () => (
                <Col gap={96} padding={{ top: 48 }}>
                    <Row justify="space-between">
                        <TipOpen placement="top" label="L" text="Clamped to the left edge" />
                        <TipOpen placement="top" label="R" text="Clamped to the right edge" />
                    </Row>
                    <Row justify="space-between">
                        <TipOpen placement="bottom-start" label="start" text="bottom-start" />
                        <TipOpen placement="bottom-end" label="end" text="bottom-end" />
                    </Row>
                </Col>
            ),
            // Live: hold a trigger — the tooltip opens; lift — it closes
            // 1.5s later. A tap on the button inside still presses it.
            'long-press': () => (
                <Col gap={28} align="center" padding={{ top: 48 }}>
                    <text class="zg-note">Hold a trigger to open its tooltip; lift to close.</text>
                    <Tooltip.Root>
                        <Tooltip.Trigger label="Save"><text>Save</text></Tooltip.Trigger>
                        <Tooltip.Popup><text>Save the document</text><Tooltip.Arrow /></Tooltip.Popup>
                    </Tooltip.Root>
                    <Tooltip.Root placement="bottom" closeDelay={3000}>
                        <Tooltip.Trigger label="Share"><text>Share (3s)</text></Tooltip.Trigger>
                        <Tooltip.Popup><text>Stays 3 seconds after release</text><Tooltip.Arrow /></Tooltip.Popup>
                    </Tooltip.Root>
                    <Tooltip.Root>
                        <Tooltip.Trigger disabled><text>Disabled</text></Tooltip.Trigger>
                        <Tooltip.Popup><text>Never shows</text><Tooltip.Arrow /></Tooltip.Popup>
                    </Tooltip.Root>
                </Col>
            ),
        },
    },
    carousel: {
        cell: (c) => (
            <view style={{ width: `${CAROUSEL_CELL_WIDTH}px` }}>
                <Carousel.Root defaultIndex={c.props['index'] as number} color={c.color} size={c.size}>
                    <Carousel.Viewport class="zg-carousel-viewport">
                        {['1', '2', '3'].map((n) => (
                            <Carousel.Item key={n}>
                                <view class="zg-slide" style={{ height: `${CAROUSEL_SLIDE_HEIGHT}px` }}><text class="zg-label">{n}</text></view>
                            </Carousel.Item>
                        ))}
                    </Carousel.Viewport>
                    <Carousel.PrevTrigger />
                    <Carousel.NextTrigger />
                    <Carousel.IndicatorGroup>
                        {[0, 1, 2].map((i) => <Carousel.Indicator key={i} index={i} />)}
                    </Carousel.IndicatorGroup>
                </Carousel.Root>
            </view>
        ),
        extras: {
            wide: () => <CarouselWide />,
        },
    },
    table: {
        cell: (c) => {
            const direction = str(c.props['sort']) as TableSortDirection | undefined;
            return (
                <view style={{ width: `${TABLE_CELL_WIDTH}px` }}>
                    <Table.Root
                        color={c.color}
                        size={c.size}
                        defaultSort={direction ? { column: 'name', direction } : null}
                    >
                        <Table.Head>
                            <Table.Row>
                                <Table.HeaderCell sortable column="name" disabled={bool(c.props['disabled'])}>Name</Table.HeaderCell>
                                <Table.HeaderCell>Qty</Table.HeaderCell>
                            </Table.Row>
                        </Table.Head>
                        <Table.Body>
                            <Table.Row><Table.Cell>Pear</Table.Cell><Table.Cell>3</Table.Cell></Table.Row>
                            <Table.Row><Table.Cell>Fig</Table.Cell><Table.Cell>12</Table.Cell></Table.Row>
                        </Table.Body>
                    </Table.Root>
                </view>
            );
        },
        extras: {
            // Zebra stripes the even body rows; the selected row (Kiwi)
            // keeps its own fill over the stripe it would have had; a
            // caption above and a foot below. Then the same held.
            zebra: () => (
                <Col gap={12}>
                    <text class="zg-label">zebra · 3rd row selected · caption + foot · color=primary</text>
                    <Table.Root mods={{ zebra: true }} color="primary">
                        <Table.Caption>Fruit stock</Table.Caption>
                        <Table.Head>
                            <Table.Row>
                                <Table.HeaderCell>Name</Table.HeaderCell>
                                <Table.HeaderCell>Origin</Table.HeaderCell>
                                <Table.HeaderCell>Qty</Table.HeaderCell>
                            </Table.Row>
                        </Table.Head>
                        <Table.Body>
                            {FRUIT_ROWS.map((row, i) => (
                                <Table.Row key={row.name} selected={i === 2}>
                                    <Table.Cell>{row.name}</Table.Cell>
                                    <Table.Cell>{row.origin}</Table.Cell>
                                    <Table.Cell>{String(row.qty)}</Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                        <Table.Foot>
                            <Table.Row>
                                <Table.Cell colSpan={2}>Total</Table.Cell>
                                <Table.Cell>{String(FRUIT_ROWS.reduce((n, r) => n + r.qty, 0))}</Table.Cell>
                            </Table.Row>
                        </Table.Foot>
                    </Table.Root>
                    <text class="zg-label">aligned columns (end) · size=sm · color=accent, sorted desc</text>
                    <Table.Root
                        size="sm"
                        color="accent"
                        mods={{ zebra: true }}
                        columns={FRUIT_COLUMNS}
                        defaultSort={{ column: 'qty', direction: 'descending' }}
                    >
                        <Table.Head />
                        <Table.Body>
                            {FRUIT_ROWS.map((row) => (
                                <Table.Row key={row.name}>
                                    <Table.Cell>{row.name}</Table.Cell>
                                    <Table.Cell>{row.origin}</Table.Cell>
                                    <Table.Cell>{String(row.qty)}</Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table.Root>
                </Col>
            ),
            // Stacked: each row a labelled block, the head hidden.
            stack: () => (
                <Col gap={12}>
                    <text class="zg-label">stack · every row a labelled block</text>
                    <Table.Root stack columns={FRUIT_COLUMNS}>
                        <Table.Head />
                        <Table.Body>
                            {FRUIT_ROWS.slice(0, 3).map((row, i) => (
                                <Table.Row key={row.name} selected={i === 1}>
                                    <Table.Cell>{row.name}</Table.Cell>
                                    <Table.Cell>{row.origin}</Table.Cell>
                                    <Table.Cell>{String(row.qty)}</Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table.Root>
                </Col>
            ),
            scroll: () => <TableScroll />,
        },
    },
    // ── Wave 5 / W5B: combobox (#1278) ──
    combobox: {
        cell: (c) => (
            <view style={FIELD_BOX}>
                <Combobox.Root
                    items={FRUIT}
                    itemValue={(o) => o.value}
                    placeholder="Search"
                    label="Fruit"
                    defaultValue={str(c.props['value']) ?? null}
                    color={c.color}
                    size={c.size}
                    invalid={bool(c.props['invalid'])}
                    disabled={bool(c.props['disabled'])}
                    readonly={bool(c.props['readonly'])}
                    clearable={bool(c.props['clearable'])}
                />
            </view>
        ),
        extras: {
            // `defaultInputValue=""`: the list filters on the text, and a
            // preset value's label would narrow it to that one option.
            open: () => (
                <ComboboxOpen note="grouped + separators · Banana selected" />
            ),
            'open-held': () => (
                <ForceStates flags={{ pressed: true }} parts={['item']}>
                    <ComboboxOpen note="every option held" />
                </ForceStates>
            ),
            'open-query': () => (
                <ComboboxOpen note={'typed "an" · autoHighlight · clearable'} query="an" />
            ),
            'open-color': () => (
                <ComboboxOpen note="secondary through the portal" color="secondary" />
            ),
            'empty-loading': () => (
                <Col gap={10}>
                    <text class="zg-note">emptyText (no match)</text>
                    <view style={FIELD_BOX}>
                        <Combobox.Root items={FRUIT} itemValue={(o) => o.value} defaultOpen defaultInputValue="zzz" emptyText="No match" label="Empty" />
                    </view>
                    <view style={{ height: '84px' }} />
                    <text class="zg-note">loading (empty held back)</text>
                    <view style={FIELD_BOX}>
                        <Combobox.Root
                            items={[] as typeof FRUIT}
                            itemValue={(o) => o.value}
                            defaultOpen
                            loading
                            loadingText="Loading…"
                            emptyText="No match"
                            label="Loading"
                        />
                    </view>
                </Col>
            ),
            // Keyboard-lift case: a combobox inside an open Dialog. Tap the
            // field — the dialog lifts above the keyboard, the list opens
            // anchored to the lifted field (flipped above when the keyboard
            // leaves no room below), and a pick fills the field.
            'in-dialog': () => (
                <Dialog.Root defaultOpen dismissible={false}>
                    <Dialog.Trigger><text>Open dialog</text></Dialog.Trigger>
                    <Dialog.Popup>
                        <Dialog.Title>Pick a fruit</Dialog.Title>
                        <Dialog.Description>Tap the field: the panel lifts and the list follows it.</Dialog.Description>
                        <Combobox.Root
                            items={FRUIT}
                            itemValue={(o) => o.value}
                            itemGroup={(o) => o.group}
                            placeholder="Search fruit"
                            label="Fruit"
                            clearable
                        />
                        <Dialog.Footer>
                            <Dialog.Close><text>Done</text></Dialog.Close>
                        </Dialog.Footer>
                    </Dialog.Popup>
                </Dialog.Root>
            ),
            // A combobox in the lower half of the screen: open at mount, the
            // list has no room below and opens ABOVE the field. Tap the field
            // too — with the keyboard up it stays above.
            'lower-half': () => (
                <Col gap={10}>
                    <text class="zg-note">lower half · open at mount · the list opens above</text>
                    <view style={{ height: '470px' }} />
                    <view style={{ width: '240px' }}>
                        <Combobox.Root
                            defaultOpen
                            items={FRUIT}
                            itemValue={(o) => o.value}
                            itemGroup={(o) => o.group}
                            groupSeparators
                            defaultValue="banana"
                            defaultInputValue=""
                            placeholder="Search fruit"
                            label="Fruit"
                        />
                    </view>
                </Col>
            ),
            tags: () => (
                <Col gap={10}>
                    <text class="zg-note">multiple: tags before the field</text>
                    <ComboboxTags />
                    <text class="zg-note">remove held</text>
                    <ForceStates flags={{ pressed: true }} parts={['tag-remove']}><ComboboxTags /></ForceStates>
                    <text class="zg-note">tag ring (forced; no keyboard on lynx)</text>
                    <ForceStates flags={{ 'focus-visible': true }} parts={['tag']}><ComboboxTags /></ForceStates>
                    <text class="zg-note">readonly · disabled</text>
                    <ComboboxTags readonly />
                    <ComboboxTags disabled />
                    <text class="zg-note">lg · accent · clearable</text>
                    <ComboboxTags size="lg" color="accent" clearable />
                </Col>
            ),
        },
    },
    // ── Wave 5 / W5D: file-upload, chat, chat-log (#1276) ──
    'file-upload': {
        cell: (c) => (
            <view style={{ width: `${FILE_UPLOAD_WIDTH}px` }}>
                <FileUpload.Root
                    color={c.color}
                    size={c.size}
                    disabled={bool(c.props['disabled'])}
                    invalid={bool(c.props['invalid'])}
                    defaultFiles={[UPLOAD_FILES[0]!]}
                >
                    <FileUpload.Trigger><text>Browse</text></FileUpload.Trigger>
                    <UploadItems />
                </FileUpload.Root>
            </view>
        ),
        extras: {
            // The dropzone: resting, highlighted (forced — lynx has no drag
            // source), disabled; the size ramp; a coloured highlight.
            dropzone: () => (
                <Col gap={10}>
                    <text class="zg-label">resting · highlighted (forced) · disabled</text>
                    <Row gap={8} align="flex-start">
                        <view style={DROP_BOX}><UploadDropzone /></view>
                        <ForceStates flags={{ highlighted: true }}>
                            <view style={DROP_BOX}><UploadDropzone /></view>
                        </ForceStates>
                        <view style={DROP_BOX}><UploadDropzone disabled /></view>
                    </Row>
                    <text class="zg-label">xs · lg · highlighted secondary / error</text>
                    <Row gap={8} align="flex-start">
                        <view style={DROP_BOX}><UploadDropzone size="xs" /></view>
                        <view style={DROP_BOX}><UploadDropzone size="lg" /></view>
                        <ForceStates flags={{ highlighted: true }}>
                            <Col gap={8}>
                                <view style={DROP_BOX}><UploadDropzone color="secondary" size="sm" /></view>
                                <view style={DROP_BOX}><UploadDropzone color="error" size="sm" /></view>
                            </Col>
                        </ForceStates>
                    </Row>
                </Col>
            ),
            // Several files, the clear trigger, a rejected file rendered
            // invalid; then held and focus-visible on every button.
            list: () => (
                <Col gap={12}>
                    <text class="zg-label">three files · clear · a rejected file (invalid)</text>
                    <UploadList />
                    <text class="zg-label">held (trigger, ×, clear) · focus-visible</text>
                    <Row gap={8} align="flex-start">
                        <ForceStates flags={{ pressed: true }}>
                            <view style={{ width: '176px' }}><UploadList compact /></view>
                        </ForceStates>
                        <ForceStates flags={{ 'focus-visible': true }}>
                            <view style={{ width: '176px' }}><UploadList compact /></view>
                        </ForceStates>
                    </Row>
                </Col>
            ),
            live: () => <UploadLive />,
        },
    },
    chat: {
        cell: (c) => (
            <view style={{ width: `${CHAT_CELL_WIDTH}px` }}>
                <Chat.Root placement={c.props['placement'] === 'end' ? 'end' : 'start'} color={c.color} size={c.size}>
                    {bool(c.props['avatar']) ? <Chat.Avatar><ChatFace initials="AL" /></Chat.Avatar> : null}
                    {bool(c.props['meta']) ? <Chat.Header>You · 12:46</Chat.Header> : null}
                    <Chat.Bubble>Hello!</Chat.Bubble>
                    {bool(c.props['meta']) ? <Chat.Footer>Seen</Chat.Footer> : null}
                </Chat.Root>
            </view>
        ),
        extras: {
            thread: () => <ChatThread />,
            // Long text wraps inside the bubble's 90% cap, on both sides and
            // beside an avatar.
            long: () => (
                <view style={{ width: '360px' }}>
                    <Chat.Root>
                        <Chat.Avatar><ChatFace initials="AL" /></Chat.Avatar>
                        <Chat.Bubble>{LONG_LINE}</Chat.Bubble>
                    </Chat.Root>
                    <Chat.Root placement="end" color="primary">
                        <Chat.Bubble>{LONG_LINE}</Chat.Bubble>
                    </Chat.Root>
                    <Chat.Root size="sm" color="neutral">
                        <Chat.Header>Grace · 09:12</Chat.Header>
                        <Chat.Bubble>{LONG_LINE}</Chat.Bubble>
                        <Chat.Footer>Delivered</Chat.Footer>
                    </Chat.Root>
                    <Chat.Root placement="end" size="lg" color="accent">
                        <Chat.Avatar><ChatFace initials="ME" /></Chat.Avatar>
                        <Chat.Bubble>{LONG_LINE}</Chat.Bubble>
                    </Chat.Root>
                </view>
            ),
        },
    },
    'chat-log': {
        cell: (c) => (
            <view style={{ width: `${CHAT_LOG_BOX.width}px`, height: `${CHAT_LOG_BOX.height}px`, display: 'flex', flexDirection: 'column' }}>
                <ChatLog.Root class="zg-chat-log" color={c.color} size={c.size} defaultFollowing={!bool(c.props['up'])}>
                    <ChatLog.Content>
                        {['Hi there', 'Hey!', 'Lunch?', 'Sure'].map((text, i) => (
                            <Chat.Root key={text} placement={i % 2 ? 'end' : 'start'} size="xs">
                                <Chat.Bubble>{text}</Chat.Bubble>
                            </Chat.Root>
                        ))}
                    </ChatLog.Content>
                    <ChatLog.JumpTrigger />
                </ChatLog.Root>
            </view>
        ),
        extras: {
            live: () => <ChatLogLive />,
        },
    },
};

/**
 * A dismissible drawer open at mount: a tap on the dim closes it
 * (`backdrop`), the system back closes it (`escape`); the note shows the last
 * close reason, and the trigger reopens it.
 */
const DrawerDismissible = component(() => {
    const state = signal({ reason: '—' });
    return () => (
        <Col gap={10} align="flex-start">
            <text class="zg-note">{`dismissible · tap the dim or press back · last close: ${state.reason}`}</text>
            <Drawer.Root defaultOpen color="primary" onClose={(detail: DrawerCloseDetail) => { state.reason = detail.reason; }}>
                <Drawer.Trigger><text>Open drawer</text></Drawer.Trigger>
                <Drawer.Panel>
                    <Drawer.Title>Dismissible</Drawer.Title>
                    <text class="zg-note">Tap outside the panel, or press back, to close it.</text>
                    <Row justify="flex-start"><Drawer.Close><text>Close</text></Drawer.Close></Row>
                </Drawer.Panel>
            </Drawer.Root>
        </Col>
    );
});

/** A drawer open at mount on `placement`: title, a few links, Close. */
const DrawerOpen = component<Define.Prop<'placement', DrawerPlacement, true> & Define.Prop<'measure', DrawerMeasure, false>>(
    ({ props }) => () => (
        <Drawer.Root defaultOpen dismissible={false} placement={props.placement} color="primary">
            <Drawer.Trigger><text>Open drawer</text></Drawer.Trigger>
            <Drawer.Panel measure={props.measure}>
                <Drawer.Title>{`Drawer · ${props.placement}${props.measure ? ` · ${props.measure}pt` : ''}`}</Drawer.Title>
                <Col gap={12}>
                    <text>Inbox</text>
                    <text>Drafts</text>
                    <text>Archive</text>
                    <Row justify="flex-start"><Drawer.Close><text>Close</text></Drawer.Close></Row>
                </Col>
            </Drawer.Panel>
        </Drawer.Root>
    ),
);

type TipOpenProps =
    & Define.Prop<'placement', 'top' | 'bottom' | 'left' | 'right' | 'bottom-start' | 'bottom-end', true>
    & Define.Prop<'color', string, false>
    & Define.Prop<'label', string, false>
    & Define.Prop<'text', string, false>;

/** A tooltip open at mount, with its arrow. */
const TipOpen = component<TipOpenProps>(({ props }) => () => (
    <Tooltip.Root defaultOpen placement={props.placement} color={props.color}>
        <Tooltip.Trigger><text>{props.label ?? props.placement}</text></Tooltip.Trigger>
        <Tooltip.Popup><text>{props.text ?? `Tooltip · ${props.placement}`}</text><Tooltip.Arrow /></Tooltip.Popup>
    </Tooltip.Root>
));

/** The table extras' data. */
const FRUIT_ROWS = [
    { name: 'Apple', origin: 'Sweden', qty: 14 },
    { name: 'Banana', origin: 'Ecuador', qty: 32 },
    { name: 'Kiwi', origin: 'Italy', qty: 7 },
    { name: 'Mango', origin: 'India', qty: 21 },
] as const;

const FRUIT_COLUMNS: readonly TableColumn[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'origin', label: 'Origin' },
    { key: 'qty', label: 'Qty', align: 'end', sortable: true },
];

/** The table `scroll` extra: fixed columns wider than the screen, sorted live by a tap. */
const TableScroll = component(() => {
    const st = signal({ sort: { column: 'name', direction: 'ascending' } as TableSort | null });
    const sorted = () => {
        const sort = st.sort;
        if (!sort) return [...FRUIT_ROWS];
        const key = sort.column as 'name' | 'qty';
        const out = [...FRUIT_ROWS].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
        return sort.direction === 'descending' ? out.reverse() : out;
    };
    return () => (
        <Col gap={12}>
            <text class="zg-label">fixed widths (520pt) · the root scrolls · tap a header to sort (three-way)</text>
            <Table.Root
                columns={[
                    { key: 'name', label: 'Name', width: 140, sortable: true },
                    { key: 'origin', label: 'Origin', width: 140 },
                    { key: 'qty', label: 'Qty', width: 100, align: 'end', sortable: true },
                    { key: 'note', label: 'Note', width: 140 },
                ]}
                sortCycle="three"
                model:sort={() => st.sort}
            >
                <Table.Head />
                <Table.Body>
                    {sorted().map((row) => (
                        <Table.Row key={row.name}>
                            <Table.Cell>{row.name}</Table.Cell>
                            <Table.Cell>{row.origin}</Table.Cell>
                            <Table.Cell>{String(row.qty)}</Table.Cell>
                            <Table.Cell>in stock</Table.Cell>
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>
            <text class="zg-note">{`sort: ${st.sort ? `${st.sort.column} ${st.sort.direction}` : 'none'}`}</text>
        </Col>
    );
});

/** The carousel `wide` extra: a full-width, live carousel. */
const CarouselWide = component(() => {
    const st = signal({ index: 1 });
    return () => (
        <Col gap={12}>
            <text class="zg-label">four slides · color=accent · size=lg · custom labels · swipe or tap</text>
            <Carousel.Root model={() => st.index} color="accent" size="lg">
                <Carousel.Viewport class="zg-carousel-viewport-wide">
                    {['One', 'Two', 'Three', 'Four'].map((n) => (
                        <Carousel.Item key={n}>
                            <view class="zg-slide" style={{ height: '140px' }}><text class="zg-title">{n}</text></view>
                        </Carousel.Item>
                    ))}
                </Carousel.Viewport>
                <Carousel.PrevTrigger label="Previous photo" />
                <Carousel.NextTrigger label="Next photo" />
                <Carousel.IndicatorGroup>
                    {[0, 1, 2, 3].map((i) => <Carousel.Indicator key={i} index={i} />)}
                </Carousel.IndicatorGroup>
            </Carousel.Root>
            <text class="zg-note">{`index: ${st.index}`}</text>
            <text class="zg-label">last slide · held (forced) · color=error</text>
            <ForceStates flags={{ pressed: true }}>
                <Carousel.Root defaultIndex={3} color="error">
                    <Carousel.Viewport class="zg-carousel-viewport">
                        {['a', 'b', 'c', 'd'].map((n) => (
                            <Carousel.Item key={n}>
                                <view class="zg-slide" style={{ height: `${CAROUSEL_SLIDE_HEIGHT}px` }}><text class="zg-label">{n}</text></view>
                            </Carousel.Item>
                        ))}
                    </Carousel.Viewport>
                    <Carousel.PrevTrigger />
                    <Carousel.NextTrigger />
                    <Carousel.IndicatorGroup>
                        {[0, 1, 2, 3].map((i) => <Carousel.Indicator key={i} index={i} />)}
                    </Carousel.IndicatorGroup>
                </Carousel.Root>
            </ForceStates>
        </Col>
    );
});

type ComboboxOpenProps =
    & Define.Prop<'note', string, true>
    & Define.Prop<'query', string, false>
    & Define.Prop<'color', string, false>;

/** A combobox open at mount: grouped, separated, "Banana" selected (#1278). */
const ComboboxOpen = component<ComboboxOpenProps>(({ props }) => () => (
    <Col gap={10}>
        <text class="zg-note">{props.note}</text>
        <view style={{ width: '240px' }}>
            <Combobox.Root
                defaultOpen
                items={FRUIT}
                itemValue={(o) => o.value}
                itemGroup={(o) => o.group}
                groupSeparators
                defaultValue={props.query === undefined ? 'banana' : null}
                defaultInputValue={props.query ?? ''}
                autoHighlight={props.query !== undefined}
                clearable={props.query !== undefined}
                color={props.color}
                placeholder="Search fruit"
                label="Fruit"
            />
        </view>
    </Col>
));

type ComboboxTagsProps =
    & Define.Prop<'readonly', boolean, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'clearable', boolean, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'color', string, false>;

/** A multiple combobox holding two tags (#1278). */
const ComboboxTags = component<ComboboxTagsProps>(({ props }) => () => (
    <view style={{ width: '260px' }}>
        <Combobox.Root
            multiple
            items={FRUIT}
            itemValue={(o) => o.value}
            defaultValue={['apple', 'carrot']}
            placeholder="Add"
            label="Fruit"
            readonly={props.readonly}
            disabled={props.disabled}
            clearable={props.clearable}
            size={props.size}
            color={props.color}
        />
    </view>
));

// ── W5D (#1276): file-upload, chat, chat-log helpers ─────────────────────

/** Canned files — what a picker would return (`FilePickerAsset`-shaped). */
const UPLOAD_FILES: readonly FileUploadFile[] = [
    { name: 'photo.png', size: 1536, mimeType: 'image/png', uri: 'file:///gallery/photo.png' },
    { name: 'report.pdf', size: 2_400_000, mimeType: 'application/pdf', uri: 'file:///gallery/report.pdf' },
    { name: 'notes-from-the-long-meeting.txt', size: 12_345, mimeType: 'text/plain', uri: 'file:///gallery/notes.txt' },
];
const REJECTED_FILE: FileUploadFile = { name: 'movie.mov', size: 48_000_000, mimeType: 'video/quicktime' };

/** A dropzone cell: a fixed box the (fluid) zone fills. */
const DROP_BOX = { width: '112px' };

/** The item rows for the model, each with name, size and remove. */
const UploadItems = component<Define.Prop<'rejected', boolean, false>>(({ props }) => () => (
    <FileUpload.ItemGroup>
        {(files: FileUploadFile[]) => [
            ...files.map((f) => (
                <FileUpload.Item key={f.uri ?? f.name} file={f}>
                    <FileUpload.ItemName />
                    <FileUpload.ItemSize />
                    <FileUpload.ItemRemove />
                </FileUpload.Item>
            )),
            props.rejected
                ? (
                    <FileUpload.Item key="rejected" file={REJECTED_FILE} invalid>
                        <FileUpload.ItemName />
                        <FileUpload.ItemSize>too large</FileUpload.ItemSize>
                    </FileUpload.Item>
                )
                : null,
        ]}
    </FileUpload.ItemGroup>
));

type UploadDropzoneProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'disabled', boolean, false>;

const UploadDropzone = component<UploadDropzoneProps>(({ props }) => () => (
    <FileUpload.Root color={props.color} size={props.size} disabled={props.disabled}>
        <FileUpload.Dropzone><text>Tap to add files</text></FileUpload.Dropzone>
    </FileUpload.Root>
));

const UploadList = component<Define.Prop<'compact', boolean, false>>(({ props }) => () => (
    <FileUpload.Root multiple defaultFiles={props.compact ? [UPLOAD_FILES[0]!] : [...UPLOAD_FILES]} color="primary">
        {props.compact ? null : <FileUpload.Label>Attachments</FileUpload.Label>}
        <FileUpload.Trigger><text>Browse…</text></FileUpload.Trigger>
        <UploadItems rejected={!props.compact} />
        <FileUpload.ClearTrigger><text>Clear all</text></FileUpload.ClearTrigger>
    </FileUpload.Root>
));

/**
 * A working upload field: the native file picker where the module is
 * linked, else a canned picker that hands back the next demo file — either
 * way the constraints run (images and PDFs, at most 3, under 10 MB).
 */
const UploadLive = component(() => {
    const st = signal({ files: [] as FileUploadFile[], rejected: '' , next: 0 });
    const pick = async ({ multiple, types }: { multiple: boolean; types: string[] }): Promise<readonly FileUploadFile[]> => {
        if (FilePicker.isAvailable()) {
            const result = await FilePicker.pick({ multiple, types });
            return result.cancelled ? [] : result.assets;
        }
        const demo = [...UPLOAD_FILES, REJECTED_FILE];
        const file = demo[st.next % demo.length]!;
        st.next += 1;
        return [file];
    };
    return () => (
        <Col gap={10}>
            <text class="zg-note">
                {FilePicker.isAvailable() ? 'Native picker (images, PDFs; max 3, < 10 MB).' : 'Canned picker: each tap adds the next demo file.'}
            </text>
            <FileUpload.Root
                model={() => st.files}
                multiple
                accept="image/*,application/pdf,text/plain"
                maxFiles={3}
                maxFileSize={10_000_000}
                pick={pick}
                onFilesReject={(r: FileRejection[]) => { st.rejected = r.map((x) => `${x.file.name}: ${x.errors.join(', ')}`).join(' · '); }}
            >
                <FileUpload.Label>Attachments</FileUpload.Label>
                <FileUpload.Dropzone><text>Tap to add files</text></FileUpload.Dropzone>
                <FileUpload.Trigger><text>Browse…</text></FileUpload.Trigger>
                <UploadItems />
                <FileUpload.ClearTrigger><text>Clear all</text></FileUpload.ClearTrigger>
            </FileUpload.Root>
            {st.rejected ? <text class="zg-label">{`Rejected — ${st.rejected}`}</text> : null}
        </Col>
    );
});

/** An initials avatar for the chat rows (reuses Avatar: no image → the fallback). */
const ChatFace = component<Define.Prop<'initials', string, true> & Define.Prop<'color', string, false>>(({ props }) => () => (
    <Avatar.Root size="md" color={props.color}>
        <Avatar.Fallback><text>{props.initials}</text></Avatar.Fallback>
    </Avatar.Root>
));

const LONG_LINE = 'A longer message that has to wrap onto several lines inside the bubble, which stops short of the row.';

/** The chat `thread` extra: a conversation in a sized log. */
const ChatThread = component(() => () => (
    <view style={{ width: '370px' }}>
        <Chat.Root>
            <Chat.Avatar><ChatFace initials="AL" color="secondary" /></Chat.Avatar>
            <Chat.Header>Ada · 12:45</Chat.Header>
            <Chat.Bubble>The contract is the anatomy.</Chat.Bubble>
        </Chat.Root>
        <Chat.Root>
            <Chat.Avatar><ChatFace initials="AL" color="secondary" /></Chat.Avatar>
            <Chat.Bubble>Everything else is a skin.</Chat.Bubble>
            <Chat.Footer>Delivered</Chat.Footer>
        </Chat.Root>
        <Chat.Root placement="end" color="primary">
            <Chat.Avatar><ChatFace initials="ME" /></Chat.Avatar>
            <Chat.Header>You · 12:46</Chat.Header>
            <Chat.Bubble>Agreed.</Chat.Bubble>
            <Chat.Footer>Seen 12:47</Chat.Footer>
        </Chat.Root>
        {(['info', 'success', 'warning', 'error'] as const).map((color, i) => (
            <Chat.Root key={color} placement={i % 2 ? 'end' : 'start'} color={color}>
                <Chat.Bubble>{color}</Chat.Bubble>
            </Chat.Root>
        ))}
        <Chat.Root size="xs"><Chat.Bubble>xs</Chat.Bubble></Chat.Root>
        <Chat.Root size="xl" placement="end" color="accent"><Chat.Bubble>xl</Chat.Bubble></Chat.Root>
    </view>
));

/**
 * The chat-log `live` extra: Send appends a row (the log follows it to the
 * end); scroll up to let go — the jump trigger appears — and Jump returns.
 */
const ChatLogLive = component(() => {
    const st = signal({ rows: 6, following: true });
    return () => (
        <Col gap={10}>
            <text class="zg-note">{st.following ? 'Following the tail' : 'Scrolled up — not following'}</text>
            <view style={{ height: '300px', display: 'flex', flexDirection: 'column' }}>
                <ChatLog.Root class="zg-chat-log" label="Live thread" model:following={() => st.following}>
                    <ChatLog.Content>
                        {Array.from({ length: st.rows }, (_, i) => (
                            <Chat.Root key={i} placement={i % 3 === 2 ? 'end' : 'start'} color={i % 3 === 2 ? 'primary' : undefined}>
                                <Chat.Bubble>{`Message ${i + 1}${i % 4 === 1 ? ' — a longer one, to wrap onto a second line' : ''}`}</Chat.Bubble>
                            </Chat.Root>
                        ))}
                    </ChatLog.Content>
                    <ChatLog.JumpTrigger />
                </ChatLog.Root>
            </view>
            <Row gap={8}>
                <Button size="sm" color="primary" onPress={() => { st.rows += 1; }}><text>Send</text></Button>
                <Button size="sm" variant="outline" onPress={() => { st.rows += 5; }}><text>Burst ×5</text></Button>
            </Row>
        </Col>
    );
});

/** The nav-list `sidebar` extra: two groups, a live current page. */
const NavSidebar = component(() => {
    const st = signal({ current: 'inbox' });
    const link = (page: string, icon: string, label: string, count?: number) => (
        <NavList.Item key={page}>
            <NavList.Link current={st.current === page} onPress={() => { st.current = page; }}>
                <NavList.Icon><text>{icon}</text></NavList.Icon>
                <text>{label}</text>
                {count === undefined ? null : <NavList.Meta><Badge.Root size="sm" color="neutral"><text>{String(count)}</text></Badge.Root></NavList.Meta>}
            </NavList.Link>
        </NavList.Item>
    );
    return () => (
        <view style={{ width: '240px' }}>
            <NavList.Root color="primary">
                <NavList.Group>
                    <NavList.Heading>Workspace</NavList.Heading>
                    <NavList.List>
                        {link('inbox', '✉', 'Inbox', 12)}
                        {link('drafts', '✎', 'Drafts', 3)}
                        {link('sent', '➤', 'Sent')}
                    </NavList.List>
                </NavList.Group>
                <NavList.Group>
                    <NavList.Heading>Settings</NavList.Heading>
                    <NavList.List>
                        {link('profile', '☺', 'Profile')}
                        {link('billing', '$', 'Billing')}
                    </NavList.List>
                </NavList.Group>
            </NavList.Root>
            <text class="zg-note">{`current: ${st.current} (tap a link)`}</text>
        </view>
    );
});

const STEP_NAMES = ['Cart', 'Ship', 'Pay'] as const;
const STEP_NOTES = ['Review the items', 'Where it goes', 'Card or invoice'] as const;

/** A live linear wizard for the `wizard` extra — a tap walks it. */
const StepsWizard = component<Define.Prop<'start', string, false>>(({ props }) => () => (
    <view style={{ width: '360px' }}>
        <Steps.Root defaultStep={props.start ?? 'cart'} linear>
            {STEP_NAMES.map((name, index) => (
                <Steps.Item key={name} value={name.toLowerCase()} label={name}>
                    <Steps.Indicator><text>{String(index + 1)}</text></Steps.Indicator>
                    <Steps.Title>{name}</Steps.Title>
                    {index < STEP_NAMES.length - 1 ? <Steps.Separator /> : null}
                </Steps.Item>
            ))}
            {STEP_NAMES.map((name, index) => (
                <Steps.Content key={name} value={name.toLowerCase()}><text>{`${name}: ${STEP_NOTES[index]!}.`}</text></Steps.Content>
            ))}
            <Steps.PrevTrigger><text>Back</text></Steps.PrevTrigger>
            <Steps.NextTrigger><text>Next</text></Steps.NextTrigger>
        </Steps.Root>
    </view>
));

/** A half-width column for the side-by-side trees (a plain view: Col/Row drop `style`). */
const TREE_BOX = { width: '180px' };

type TreeCellProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    /** The selected node ('' = none). Not `value`: that name collides with emit. */
    & Define.Prop<'selected', string, true>
    & Define.Prop<'closed', boolean, false>
    & Define.Prop<'loading', boolean, false>
    & Define.Prop<'nodeDisabled', boolean, false>
    & Define.Prop<'disabled', boolean, false>;

/** One tree-view cell: "Dir" (open unless `closed`) over "a", then "b". */
const TreeCell = component<TreeCellProps>(({ props }) => () => (
    <TreeView.Root
        color={props.color}
        size={props.size}
        defaultValue={props.selected}
        defaultExpandedValues={props.closed ? [] : ['dir']}
        disabled={props.disabled}
    >
        <TreeView.Tree>
            <TreeView.Branch value="dir" loading={props.loading}>
                <TreeView.BranchTrigger><TreeView.BranchIndicator /><text>Dir</text></TreeView.BranchTrigger>
                <TreeView.BranchContent>
                    <TreeView.Item value="a"><text>a</text></TreeView.Item>
                </TreeView.BranchContent>
            </TreeView.Branch>
            <TreeView.Item value="b" disabled={props.nodeDisabled}><text>b</text></TreeView.Item>
        </TreeView.Tree>
    </TreeView.Root>
));

type CheckTreeProps =
    & Define.Prop<'selected', readonly string[], false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'disabled', boolean, false>;

/**
 * A checkable tree: "Dir" mixed (a checked, b not, c disabled), "All"
 * collapsed but checked (x, y — its leaves stay registered), and "d". With `selected`, a multiple selection is in use
 * too, so the boxes sit on selected rows.
 */
const CheckTree = component<CheckTreeProps>(({ props }) => () => (
    <TreeView.Root
        checkable
        multiple
        color={props.color}
        disabled={props.disabled}
        defaultValue={[...(props.selected ?? [])]}
        defaultCheckedValues={['a', 'x', 'y']}
        defaultExpandedValues={['dir']}
    >
        <TreeView.Tree>
            <TreeView.Branch value="dir">
                <TreeView.BranchTrigger><TreeView.NodeCheckbox /><TreeView.BranchIndicator /><text>Dir</text></TreeView.BranchTrigger>
                <TreeView.BranchContent>
                    <TreeView.Item value="a"><TreeView.NodeCheckbox /><text>a</text></TreeView.Item>
                    <TreeView.Item value="b"><TreeView.NodeCheckbox /><text>b</text></TreeView.Item>
                    <TreeView.Item value="c" disabled><TreeView.NodeCheckbox /><text>c</text></TreeView.Item>
                </TreeView.BranchContent>
            </TreeView.Branch>
            <TreeView.Branch value="all">
                <TreeView.BranchTrigger><TreeView.NodeCheckbox /><TreeView.BranchIndicator /><text>All</text></TreeView.BranchTrigger>
                <TreeView.BranchContent>
                    <TreeView.Item value="x"><TreeView.NodeCheckbox /><text>x</text></TreeView.Item>
                    <TreeView.Item value="y"><TreeView.NodeCheckbox /><text>y</text></TreeView.Item>
                </TreeView.BranchContent>
            </TreeView.Branch>
            <TreeView.Item value="d"><TreeView.NodeCheckbox /><text>d</text></TreeView.Item>
        </TreeView.Tree>
    </TreeView.Root>
));

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

type BreadcrumbTrailProps =
    & Define.Prop<'labels', readonly string[], true>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'maxItems', number, false>
    & Define.Prop<'before', number, false>
    & Define.Prop<'after', number, false>
    & Define.Prop<'separator', string, false>;

/**
 * One breadcrumb trail, the last label current. The ellipsis sits after the
 * leading `before` items, where the collapse leaves the gap.
 */
const BreadcrumbTrail = component<BreadcrumbTrailProps>(({ props }) => () => {
    const last = props.labels.length - 1;
    const before = props.before ?? 1;
    const sep = (): JSXElement => (props.separator ? <Breadcrumbs.Separator>{props.separator}</Breadcrumbs.Separator> : <Breadcrumbs.Separator />);
    const item = (label: string, i: number): JSXElement => (
        <Breadcrumbs.Item key={label}>
            <Breadcrumbs.Link current={i === last}><text>{label}</text></Breadcrumbs.Link>
            {i === last ? null : sep()}
        </Breadcrumbs.Item>
    );
    return (
        <Breadcrumbs.Root
            color={props.color}
            size={props.size}
            maxItems={props.maxItems}
            itemsBeforeCollapse={props.before}
            itemsAfterCollapse={props.after}
        >
            <Breadcrumbs.List>
                {props.labels.slice(0, before).map((label, i) => item(label, i))}
                <Breadcrumbs.Ellipsis>
                    <Breadcrumbs.EllipsisTrigger />
                    {sep()}
                </Breadcrumbs.Ellipsis>
                {props.labels.slice(before).map((label, i) => item(label, i + before))}
            </Breadcrumbs.List>
        </Breadcrumbs.Root>
    );
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
