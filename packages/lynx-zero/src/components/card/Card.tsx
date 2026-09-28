/**
 * Card — a surface with a conventional interior (zero's `card` scope). No
 * state and no behavior: the bands are styling containers, and the axes
 * ride the root.
 *
 * ```tsx
 * <Card.Root color="primary">
 *     <Card.Media><image src={cover} mode="aspectFill" style={{ width: '100%', height: '120px' }} /></Card.Media>
 *     <Card.Header>
 *         <Card.Title>Monthly report</Card.Title>
 *         <Card.Description>Updated 4 minutes ago</Card.Description>
 *     </Card.Header>
 *     <Card.Body><text>…</text></Card.Body>
 *     <Card.Footer><Button><text>Open</text></Button></Card.Footer>
 * </Card.Root>
 * ```
 *
 * The lynx spellings:
 *
 * - **Every part is a `view`, Title and Description are `<text>`.** Zero's
 *   `h3` / `p` defaults become text parts; the Title carries the `header`
 *   accessibility trait (the heading, in native-reader terms).
 * - **No `asChild`.** There is no element to swap on lynx — an `<article>`
 *   or a `<figure>` does not exist here. Put an `<image>` INSIDE `Media`.
 * - **Media's ends are stamped.** The skin rounds the corners the media
 *   band shares with the card, which the web selects with `:first-child` /
 *   `:last-child`. Lynx has neither, so the root tracks its bands (media,
 *   header, body, footer) in mount order and stamps `first` / `last` on
 *   the media band (`zx-m-first` / `zx-m-last`) — a lynx-zero rendering
 *   detail, not modifiers an author sets (ToggleGroup's precedent). A band
 *   mounted later (a conditional one) joins the END of that order.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.card;

/** A band's place at the ends of the card — both for an only band. */
export interface CardBandEnds {
    first: boolean;
    last: boolean;
}

/** Where band `id` sits at the ends of `order` (the pure half of the root's tracking). */
export function cardBandEnds(order: readonly number[], id: number): CardBandEnds {
    return { first: order.length > 0 && order[0] === id, last: order.length > 0 && order[order.length - 1] === id };
}

interface CardContext {
    /** Join the card's band order (mount order); returns the leave function. */
    register(id: number): () => void;
    ends(id: number): CardBandEnds;
}

const useCardContext = defineInjectable<CardContext>(() => ({
    register: () => () => {},
    ends: () => ({ first: false, last: false }),
}));

/** Band ids, unique across every card (only compared, never shown). */
let nextBandId = 0;

// ── Root ──

export type CardRootProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const CardRoot = component<CardRootProps>(({ props, slots }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    const bands = signal({ order: [] as number[] });
    defineProvide(useCardContext, () => ({
        register: (id) => {
            bands.order = [...bands.order, id];
            return () => { bands.order = bands.order.filter((other) => other !== id); };
        },
        ends: (id) => cardBandEnds(bands.order, id),
    }));
    return () => (
        <view {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Card.Root' });

// ── Bands ──

export type CardPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;
export type CardMediaProps = CardPartProps;

/**
 * Media (zero#302) — the full-bleed band: the skin draws it edge to edge
 * and rounds the corners it shares with the card, from the `first` /
 * `last` stamps.
 */
const CardMedia = component<CardMediaProps>(({ props, slots, onUnmounted }) => {
    const axes = useVariantAxes();
    const card = useCardContext();
    const id = ++nextBandId;
    onUnmounted(card.register(id));
    return () => {
        const ends = card.ends(id);
        const a = partAxes(axes());
        return (
            <view {...partBag(anatomy, 'media', { ...a, mods: { ...a.mods, first: ends.first, last: ends.last }, class: props.class })}>
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Card.Media' });

/** The three plain bands: one component, a different part name. */
function makeBand(part: 'header' | 'body' | 'footer', name: string) {
    return component<CardPartProps>(({ props, slots, onUnmounted }) => {
        const axes = useVariantAxes();
        // Joins the order so the media band knows whether it is at an end.
        onUnmounted(useCardContext().register(++nextBandId));
        return () => (
            <view {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </view>
        );
    }, { name });
}

// ── Title / Description ──

export type CardTextProps = CardPartProps;

const CardTitle = component<CardTextProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text
            {...partBag(anatomy, 'title', { ...partAxes(axes()), class: props.class })}
            {...partA11y({ trait: 'header' })}
        >
            {slots.default?.()}
        </text>
    );
}, { name: 'Card.Title' });

const CardDescription = component<CardTextProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'description', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Card.Description' });

const CardHeader = makeBand('header', 'Card.Header');
const CardBody = makeBand('body', 'Card.Body');
const CardFooter = makeBand('footer', 'Card.Footer');

export const Card = compound(CardRoot, {
    Root: CardRoot,
    Media: CardMedia,
    Header: CardHeader,
    Title: CardTitle,
    Description: CardDescription,
    Body: CardBody,
    Footer: CardFooter,
});
