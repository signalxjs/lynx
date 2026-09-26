/**
 * Zero state-matrix gallery (#1141, epic #1140) — every axis value × every
 * forced interaction state of a lynx-zero scope, on one screen, with no
 * taps: the surface `scripts/zero-qa/shoot.mjs` screenshots.
 *
 *   /zero-gallery                    index (scopes → sections)
 *   /zero-gallery/:scope             every section of a scope, scrollable
 *   /zero-gallery/:scope/:section    one section, header hidden — one screenshot
 *
 * `?theme=<name>` picks the zero theme (default: the skin's light theme).
 * Deep-linkable cold: `xcrun simctl openurl booted showcase://zero-gallery/button/color`.
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
import { component } from '@sigx/lynx';
import { Screen, useNav, useParams, useSearch } from '@sigx/lynx-navigation';
import {
    Accordion, Button, Col, Dialog, Popover, Progress, ScrollView, Select, Slider,
    Switch, Tabs, Timeline, Toast, ZeroRoot, createToaster,
} from '@sigx/lynx-zero';
import { ForceStates } from '@sigx/lynx-zero/testing';
import type { GalleryAxis, GalleryScope, GalleryScopeId, GalleryState } from './scopes.js';
import { GALLERY_SCOPES, gallerySections, parseSection } from './scopes.js';

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

const bool = (value: unknown): boolean => value === true;

/** The render half of the registry — one entry per scope in `scopes.ts`. */
const RENDER: Record<GalleryScopeId, GalleryRenderer> = {
    button: {
        cell: (c) => (
            <Button color={c.color} size={c.size} variant={c.variant} disabled={bool(c.props['disabled'])}>
                <text>Btn</text>
            </Button>
        ),
    },
    switch: {
        cell: (c) => (
            <Switch
                color={c.color}
                size={c.size}
                defaultChecked={bool(c.props['checked'])}
                disabled={bool(c.props['disabled'])}
            />
        ),
    },
    slider: {
        cell: (c) => (
            <Slider.Root color={c.color} size={c.size} min={0} max={100} defaultValue={40} disabled={bool(c.props['disabled'])} />
        ),
    },
    progress: {
        cell: (c) => (
            <Progress.Root value={c.props['value'] as number | null} color={c.color} size={c.size}>
                <Progress.Track><Progress.Range /></Progress.Track>
            </Progress.Root>
        ),
    },
    tabs: {
        cell: (c) => (
            <Tabs.Root defaultValue="a" color={c.color} size={c.size} variant={c.variant}>
                <Tabs.List>
                    <Tabs.Tab value="a"><text>A</text></Tabs.Tab>
                    <Tabs.Tab value="b" disabled={bool(c.props['disabled'])}><text>B</text></Tabs.Tab>
                </Tabs.List>
            </Tabs.Root>
        ),
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
                items={FRUIT}
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
        },
    },
    toast: {
        extras: {
            open: () => <ToastsOpen />,
        },
    },
};

/** Toasts need a live store: three pinned toasts (duration 0 = no timer). */
const ToastsOpen = component(() => {
    const toaster = createToaster();
    toaster.show({ title: 'Saved', description: 'Your changes were saved.', duration: 0 });
    toaster.show({ title: 'Heads up', description: 'A second toast, stacked.', duration: 0 });
    toaster.show({ title: 'Title only', duration: 0 });
    return () => <Toast.Viewport placement="top" toaster={toaster} />;
});

const LABEL_WIDTH = 52;

function forced(state: GalleryState, node: JSXElement): JSXElement {
    if (!state.flags) return node;
    return <ForceStates flags={state.flags} parts={state.parts}>{node}</ForceStates>;
}

type MatrixProps =
    & Define.Prop<'scope', GalleryScopeId, true>
    & Define.Prop<'axis', GalleryAxis, true>
    & Define.Prop<'values', readonly string[], true>;

/** One axis block: a header row of state labels, then one row per axis value. */
const Matrix = component<MatrixProps>(({ props }) => {
    return () => {
        const entry: GalleryScope = GALLERY_SCOPES[props.scope];
        const render = RENDER[props.scope].cell;
        const width = entry.cellWidth ?? 76;
        // Label column + a wrapping cell area: when the states wrap onto a
        // second line they stay under the header's columns, not the label.
        const row = { display: 'flex', flexDirection: 'row', alignItems: 'flex-start' };
        const cells = { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: '6px', flexGrow: 1, flexShrink: 1, flexBasis: '0px' };
        return (
            <view style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <view style={row}>
                    <view style={{ width: `${LABEL_WIDTH}px` }} />
                    <view style={cells}>
                        {entry.states.map((state) => (
                            <text key={state.id} class="zg-head" style={{ width: `${width}px` }}>{state.label}</text>
                        ))}
                    </view>
                </view>
                {props.values.map((value) => (
                    <view key={value} style={row}>
                        <text class="zg-label" style={{ width: `${LABEL_WIDTH}px`, paddingTop: '4px' }}>{value}</text>
                        <view style={cells}>
                            {entry.states.map((state) => (
                                <view key={state.id} style={{ width: `${width}px`, paddingRight: '6px' }}>
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
            <view style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '12px' }}>
                <text class="zg-title">{`${entry.title} · ${props.section}`}</text>
                {body}
            </view>
        );
    };
});

function knownScope(scope: string): scope is GalleryScopeId {
    return Object.prototype.hasOwnProperty.call(GALLERY_SCOPES, scope);
}

const Frame = component<Define.Prop<'theme', string | undefined, false> & Define.Slot<'default'>>(({ props, slots }) => {
    return () => (
        <ZeroRoot initial={props.theme ?? 'light'}>
            <ScrollView flex={1}>
                <Col padding={12} gap={4}>{slots.default?.()}</Col>
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
    return () => (
        <Frame theme={search.theme}>
            <Screen title={`${scope} · ${section}`} headerShown={false} />
            {knownScope(scope)
                ? <Section scope={scope} section={section} />
                : <text class="zg-error">{`Unknown scope "${scope}"`}</text>}
        </Frame>
    );
});
