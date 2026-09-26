/**
 * Slider — the gesture composite of the pilot, tier 1: touch events drive
 * the value signal directly (`bindtouchstart/move/end` on the control), the
 * same shape press feedback ships in. The platform-idiomatic tier 2 — a
 * main-thread worklet writing the thumb transform mid-drag — is an opt-in
 * follow-up and touches ONLY transform/opacity, so the two tiers can never
 * fight over recipe-owned paint.
 *
 * Geometry: a touch maps to a fraction of the track through the track's
 * VIEWPORT rect (`useViewportRect` → `boundingClientRect`) against the
 * touch's `clientX`/`clientY`. The `bindlayoutchange` payload is not
 * page-relative on Android (its left/top arrive as 0 — measured, #1081), so
 * a slider anywhere but the page origin mapped touches to the wrong value
 * there. The layout frame stays the first-touch fallback (the viewport rect
 * lands a frame or two after the first measurement), and every touch-down
 * re-measures, so a scrolled page is caught by the next touch.
 *
 * Paint is runtime-written inline: the range's extent and each thumb's
 * position are PHYSICAL percentages of the track (`left`/`width`, or
 * `top`/`height` when vertical) — the lynx counterpart of the web's
 * `--slider-percent` runtime property and logical insets, which the
 * capability set rejects on this target (logical insets do not resolve on
 * Android, #1084). Skins own everything else about track/range/thumb/mark.
 *
 * Zero 0.6 anatomy, projected:
 * - **Range model**: `model`/`defaultValue` may be a `number[]` — one
 *   `thumb` part per value, the `range` spanning lowest → highest. A touch
 *   moves the NEAREST thumb and drags it; thumbs never cross (each clamps at
 *   its neighbour plus `minStepsBetweenThumbs` steps). Emission keeps the
 *   model's shape: scalar in, scalar out.
 * - **`orientation="vertical"`**: the rail runs bottom-to-top (APG),
 *   `data-orientation`/`zx-o-vertical` on the root and every positioned
 *   part, so a skin restyles the channel against it.
 * - **`readonly`** (the prop OR the Field's): announced, never moved — no
 *   press, no drag, no pressed flag.
 * - **`valueCommit`**: fires once when a drag ends, only when the value
 *   actually moved, with the model's shape.
 *
 * `hidden-input` is omitted — no forms on lynx, and the anatomy oracle walks
 * rendered parts. Marks are ticks only (no label text on this target).
 */
import type { Define, JSXElement, LayoutChangeEvent } from '@sigx/lynx';
import { component, compound, signal, useElementLayout, useViewportRect } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, useFieldContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.slider;

export type SliderOrientation = 'horizontal' | 'vertical';

interface SliderTouch {
    pageX?: number;
    pageY?: number;
    clientX?: number;
    clientY?: number;
    x?: number;
    y?: number;
}

interface SliderTouchEvent {
    touches?: SliderTouch[];
    changedTouches?: SliderTouch[];
}

/** A measured box: page-space (layout) or viewport-space (bounding rect). */
export interface SliderRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * The fraction of the rail a point sits at, 0 at the rail's start (left, or
 * the BOTTOM when vertical) — unclamped; `null` when the rect has no extent
 * along the axis. Pure, so the Android geometry fix is testable without a
 * main thread.
 */
export function sliderFraction(
    point: { x: number; y: number },
    rect: SliderRect,
    orientation: SliderOrientation = 'horizontal',
): number | null {
    if (orientation === 'vertical') {
        if (!(rect.height > 0)) return null;
        return (rect.top + rect.height - point.y) / rect.height;
    }
    if (!(rect.width > 0)) return null;
    return (point.x - rect.left) / rect.width;
}

export type SliderRootProps =
    /** One value, or one per thumb (`number[]`) — emission keeps the shape. */
    & Define.Model<number | number[]>
    & Define.Prop<'defaultValue', number | number[], false>
    & Define.Event<'valueChange', number | number[]>
    /** End of a drag that moved the value — once, with the model's shape. */
    & Define.Event<'valueCommit', number | number[]>
    & Define.Prop<'min', number, false>
    & Define.Prop<'max', number, false>
    & Define.Prop<'step', number, false>
    /** Range model: the closest two thumbs may come, in steps. Default 0. */
    & Define.Prop<'minStepsBetweenThumbs', number, false>
    & Define.Prop<'orientation', SliderOrientation, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    /** Announced, never moved by a touch. The prop OR the Field's. */
    & Define.Prop<'readonly', boolean, false>
    /** Track positions (in value space) rendered as `mark` parts. */
    & Define.Prop<'marks', number[], false>
    /** Visible label part + the accessible name. */
    & Define.Prop<'label', string, false>
    /** Render the `value-text` part. */
    & Define.Prop<'showValue', boolean, false>
    & Define.Prop<'formatValue', (value: number) => string, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>;

const sameValues = (a: readonly number[], b: readonly number[]): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);

const SliderRoot = component<SliderRootProps>(({ props, emit }) => {
    // Same guard family as Progress: a non-finite or inverted range must
    // never reach paint as NaN%.
    const min = () => {
        const raw = props.min ?? 0;
        return Number.isFinite(raw) ? raw : 0;
    };
    const max = () => {
        const raw = props.max ?? 100;
        return Number.isFinite(raw) && raw > min() ? raw : min() + 100;
    };
    const step = () => {
        const raw = props.step ?? 1;
        return Number.isFinite(raw) && raw > 0 ? raw : 1;
    };
    const gap = () => {
        const raw = props.minStepsBetweenThumbs ?? 0;
        return Number.isFinite(raw) && raw > 0 ? raw * step() : 0;
    };
    const orientation = (): SliderOrientation => (props.orientation === 'vertical' ? 'vertical' : 'horizontal');
    const clamp = (raw: number): number => Math.min(max(), Math.max(min(), raw));
    const snap = (raw: number): number => clamp(min() + Math.round((raw - min()) / step()) * step());
    const finiteOr = (raw: unknown, fallback: number): number =>
        typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;

    const initial = (): number | number[] => {
        const raw = props.defaultValue;
        if (Array.isArray(raw)) {
            return raw.map((v) => snap(finiteOr(v, min()))).sort((a, b) => a - b);
        }
        return snap(finiteOr(raw, min()));
    };
    const state = createControllableState<number | number[]>(
        () => props.model,
        initial(),
        (value) => emit('valueChange', value),
    );
    const field = useFieldContext();
    const disabled = () => !!props.disabled || field.disabled();
    const invalid = () => !!props.invalid || field.invalid();
    const readonly = () => !!props.readonly || field.readonly();
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));

    /** The model, normalized to an array (a scalar model is `[value]`). */
    const values = (): number[] => {
        const v = state.value;
        return Array.isArray(v) ? v.map((x) => finiteOr(x, min())) : [finiteOr(v, min())];
    };
    const isRange = () => Array.isArray(state.value);

    /** The value `index` may take: the rail, tightened at each neighbour. */
    const boundsAt = (index: number, current: readonly number[]): { lo: number; hi: number } => {
        const lo = index > 0 ? current[index - 1]! + gap() : min();
        const hi = index < current.length - 1 ? current[index + 1]! - gap() : max();
        return { lo: Math.min(lo, max()), hi: Math.max(hi, min()) };
    };

    /** Write one value — snapped, clamped to the rail AND its neighbours. */
    const setValueAt = (index: number, raw: number): void => {
        const current = values();
        const { lo, hi } = boundsAt(index, current);
        const next = Math.min(hi, Math.max(lo, snap(raw)));
        if (current[index] === next) return;
        if (isRange()) {
            const out = current.slice();
            out[index] = next;
            state.value = out;
        } else {
            state.value = next;
        }
    };

    const layout = useElementLayout();
    const viewport = useViewportRect();
    const dragging = signal(false);
    const active = signal(0);
    let dragStart: number[] = [];

    const percent = (value: number): number => ((clamp(value) - min()) / (max() - min())) * 100;

    const valueAt = (event: SliderTouchEvent): number | null => {
        const t = event.changedTouches?.[0] ?? event.touches?.[0];
        if (!t) return null;
        // Viewport rect + client coordinates when measured; the layout
        // frame + page coordinates until then (right on iOS, and the
        // fallback everywhere for the first touch).
        const live = viewport.rect.value;
        const useLive = !!live && live.width > 0 && live.height > 0;
        const rect = useLive ? live : layout.layout.value;
        if (!rect) return null;
        const x = useLive ? (t.clientX ?? t.pageX ?? t.x) : (t.pageX ?? t.x);
        const y = useLive ? (t.clientY ?? t.pageY ?? t.y) : (t.pageY ?? t.y);
        if (typeof x !== 'number' || typeof y !== 'number') return null;
        const fraction = sliderFraction({ x, y }, rect, orientation());
        if (fraction === null) return null;
        return min() + fraction * (max() - min());
    };

    /** The thumb a touch at `value` grabs: the nearest; ties go its way. */
    const nearest = (value: number): number => {
        const current = values();
        let best = 0;
        for (let i = 1; i < current.length; i++) {
            const d = Math.abs(current[i]! - value);
            const bestD = Math.abs(current[best]! - value);
            if (d < bestD || (d === bestD && value > current[i]!)) best = i;
        }
        return best;
    };

    const inert = () => disabled() || readonly();

    const format = (value: number): string => (props.formatValue ?? String)(value);

    /** Physical placement along the rail, `p` in 0..100. */
    const at = (p: number): Record<string, string> =>
        orientation() === 'vertical' ? { top: `${100 - p}%` } : { left: `${p}%` };

    return () => {
        const o = orientation();
        const vals = values();
        const lo = isRange() ? percent(vals[0]!) : 0;
        const hi = percent(vals[vals.length - 1]!);
        const rangeStyle: Record<string, string | number> = o === 'vertical'
            ? { position: 'absolute', left: 0, width: '100%', top: `${100 - hi}%`, height: `${hi - lo}%` }
            : { position: 'absolute', left: `${lo}%`, top: 0, bottom: 0, width: `${hi - lo}%` };
        return (
            <view
                {...partBag(anatomy, 'root', {
                    flags: { disabled: disabled(), invalid: invalid(), readonly: readonly() },
                    ...partAxes(axes()),
                    orientation: o,
                    class: props.class,
                })}
            >
                {props.label
                    ? (
                        <text {...partBag(anatomy, 'label', { flags: { disabled: disabled() }, ...partAxes(axes()) })}>
                            {props.label}
                        </text>
                    )
                    : null}
                <view
                    {...partBag(anatomy, 'control', {
                        flags: { disabled: disabled(), invalid: invalid(), readonly: readonly(), pressed: dragging.value },
                        ...partAxes(axes()),
                        orientation: o,
                    })}
                    {...partA11y({ trait: 'adjustable', label: props.label, disabled: disabled() })}
                    bindtouchstart={(event: SliderTouchEvent) => {
                        if (inert()) return;
                        // Catch a scroll since the last measurement for the
                        // next touch (the rect lands asynchronously).
                        viewport.measure();
                        const value = valueAt(event);
                        dragStart = values();
                        active.value = value === null ? 0 : nearest(value);
                        dragging.value = true;
                        if (value !== null) setValueAt(active.value, value);
                    }}
                    bindtouchmove={(event: SliderTouchEvent) => {
                        if (!dragging.value) return;
                        const value = valueAt(event);
                        if (value !== null) setValueAt(active.value, value);
                    }}
                    bindtouchend={() => {
                        if (!dragging.value) return;
                        dragging.value = false;
                        if (!sameValues(dragStart, values())) emit('valueCommit', state.value);
                    }}
                    bindtouchcancel={() => {
                        if (!dragging.value) return;
                        dragging.value = false;
                        if (!sameValues(dragStart, values())) emit('valueCommit', state.value);
                    }}
                >
                    <view
                        {...partBag(anatomy, 'track', {
                            flags: { disabled: disabled(), readonly: readonly() },
                            ...partAxes(axes()),
                            orientation: o,
                        })}
                        style={{ position: 'relative' }}
                        main-thread:ref={viewport.ref}
                        bindlayoutchange={(event: LayoutChangeEvent) => {
                            layout.onLayoutChange(event);
                            viewport.measure();
                        }}
                    >
                        <view
                            {...partBag(anatomy, 'range', { flags: { disabled: disabled() }, ...partAxes(axes()), orientation: o })}
                            style={rangeStyle}
                        />
                        {(props.marks ?? []).filter((mark) => Number.isFinite(mark)).map((mark) => (
                            <view
                                key={mark}
                                {...partBag(anatomy, 'mark', { flags: { disabled: disabled() }, ...partAxes(axes()), orientation: o })}
                                style={{ position: 'absolute', ...at(percent(mark)), ...(o === 'vertical' ? { left: 0 } : {}) }}
                            />
                        ))}
                        {vals.map((value, index) => (
                            <view
                                key={index}
                                {...partBag(anatomy, 'thumb', {
                                    flags: {
                                        disabled: disabled(),
                                        readonly: readonly(),
                                        pressed: dragging.value && active.value === index,
                                    },
                                    ...partAxes(axes()),
                                    orientation: o,
                                })}
                                style={{ position: 'absolute', ...at(percent(value)), ...(o === 'vertical' ? { left: '50%' } : {}) }}
                            />
                        ))}
                    </view>
                </view>
                {props.showValue
                    ? (
                        <text {...partBag(anatomy, 'value-text', { ...partAxes(axes()) })}>
                            {vals.map(format).join(' – ')}
                        </text>
                    )
                    : null}
            </view>
        );
    };
}, { name: 'Slider.Root' });

/** The model's shape: one value, or one per thumb. */
export type SliderValue = number | number[];

type SliderRootJsxProps = Parameters<typeof SliderRoot>[0];

/**
 * `Slider.Root`'s JSX surface, generic over the model's shape so a scalar
 * slider's handlers take a `number` and a range slider's a `number[]`:
 * `V` is inferred from `defaultValue` or the handler's annotation, and
 * defaults to the scalar.
 */
export type SliderRootComponent = <V extends SliderValue = number>(
    props: Omit<SliderRootJsxProps, 'defaultValue' | 'onValueChange' | 'onValueCommit'> & {
        defaultValue?: V;
        onValueChange?: (value: V) => void;
        onValueCommit?: (value: V) => void;
    },
) => JSXElement;

export const Slider = compound(SliderRoot, { Root: SliderRoot }) as unknown as SliderRootComponent & {
    Root: SliderRootComponent;
};
