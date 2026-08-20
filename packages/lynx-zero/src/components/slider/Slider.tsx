/**
 * Slider — the gesture composite of the pilot, tier 1: touch events drive
 * the value signal directly (`bindtouchstart/move/end` on the control, the
 * track's page-relative rect from `bindlayoutchange` turns a touch's
 * `pageX` into a fraction), the same shape press feedback ships in. The
 * platform-idiomatic tier 2 — a main-thread worklet writing the thumb
 * transform mid-drag — is an opt-in follow-up and touches ONLY transform/
 * opacity, so the two tiers can never fight over recipe-owned paint.
 *
 * Paint is runtime-written inline: the range's `width` and the thumb's
 * `left` are percentages of the track — the lynx counterpart of the web's
 * `--slider-percent` runtime property, which the capability set rejects in
 * shared recipe sections precisely because THIS is how the value reaches
 * paint here. Skins own everything else about track/range/thumb.
 *
 * Horizontal only in v1 (the pilot's scope); `hidden-input` omitted like
 * Switch — no forms on lynx, and the anatomy oracle walks rendered parts.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, signal, useElementLayout } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, useFieldContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.slider;

interface SliderTouch {
    pageX?: number;
    x?: number;
}

interface SliderTouchEvent {
    touches?: SliderTouch[];
    changedTouches?: SliderTouch[];
}

export type SliderRootProps =
    & Define.Model<number>
    & Define.Prop<'defaultValue', number, false>
    & Define.Event<'valueChange', number>
    & Define.Prop<'min', number, false>
    & Define.Prop<'max', number, false>
    & Define.Prop<'step', number, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
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
    const clamp = (raw: number): number => Math.min(max(), Math.max(min(), raw));
    const snap = (raw: number): number => clamp(min() + Math.round((raw - min()) / step()) * step());

    const state = createControllableState<number>(
        () => props.model,
        snap(Number.isFinite(props.defaultValue ?? min()) ? (props.defaultValue ?? min()) : min()),
        (value) => emit('valueChange', value),
    );
    const field = useFieldContext();
    const disabled = () => !!props.disabled || field.disabled();
    const invalid = () => !!props.invalid || field.invalid();
    const axes = (): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size });
    provideVariantAxes(axes);

    const track = useElementLayout();
    const dragging = signal(false);

    const percent = (value: number): number => ((clamp(value) - min()) / (max() - min())) * 100;

    const valueAt = (event: SliderTouchEvent): number | null => {
        const rect = track.layout.value;
        if (!rect || rect.width <= 0) return null;
        const t = event.changedTouches?.[0] ?? event.touches?.[0];
        const pageX = t?.pageX ?? t?.x;
        if (typeof pageX !== 'number') return null;
        const fraction = (pageX - rect.left) / rect.width;
        return snap(min() + fraction * (max() - min()));
    };

    const moveTo = (event: SliderTouchEvent): void => {
        const next = valueAt(event);
        if (next !== null && next !== state.value) state.value = next;
    };

    const format = (): string => (props.formatValue ?? String)(state.value);

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: disabled(), invalid: invalid() },
                ...partAxes(axes()),
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
                    flags: { disabled: disabled(), invalid: invalid(), pressed: dragging.value },
                    ...partAxes(axes()),
                })}
                {...partA11y({ trait: 'adjustable', label: props.label, disabled: disabled() })}
                bindtouchstart={(event: SliderTouchEvent) => {
                    if (disabled()) return;
                    dragging.value = true;
                    moveTo(event);
                }}
                bindtouchmove={(event: SliderTouchEvent) => {
                    if (!dragging.value) return;
                    moveTo(event);
                }}
                bindtouchend={() => {
                    dragging.value = false;
                }}
                bindtouchcancel={() => {
                    dragging.value = false;
                }}
            >
                <view
                    {...partBag(anatomy, 'track', { flags: { disabled: disabled() }, ...partAxes(axes()) })}
                    style={{ position: 'relative' }}
                    bindlayoutchange={track.onLayoutChange}
                >
                    <view
                        {...partBag(anatomy, 'range', { flags: { disabled: disabled() }, ...partAxes(axes()) })}
                        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${percent(state.value)}%` }}
                    />
                    {(props.marks ?? []).filter((mark) => Number.isFinite(mark)).map((mark) => (
                        <view
                            key={mark}
                            {...partBag(anatomy, 'mark', { flags: { disabled: disabled() }, ...partAxes(axes()) })}
                            style={{ position: 'absolute', left: `${percent(mark)}%` }}
                        />
                    ))}
                    <view
                        {...partBag(anatomy, 'thumb', {
                            flags: { disabled: disabled(), pressed: dragging.value },
                            ...partAxes(axes()),
                        })}
                        style={{ position: 'absolute', left: `${percent(state.value)}%` }}
                    />
                </view>
            </view>
            {props.showValue
                ? (
                    <text {...partBag(anatomy, 'value-text', { ...partAxes(axes()) })}>
                        {format()}
                    </text>
                )
                : null}
        </view>
    );
}, { name: 'Slider.Root' });

export const Slider = compound(SliderRoot, { Root: SliderRoot });
