/**
 * Progress — the pilot's first component on purpose: pure paint, no
 * interaction, so it proves the whole pipeline (anatomy → partBag classes →
 * compiled skin CSS → themed literals) with nothing else in the frame.
 *
 * Zero's state semantics, verbatim: `value: null` is `indeterminate`,
 * `value >= max` is `complete`, anything else is `loading`. One divergence
 * by construction: the web recipe reads the runtime-published
 * `--progress-percent` for the range's width; that mechanism is web-only
 * (`RUNTIME_PROPERTIES`), so here the range's inline-size is an INLINE
 * STYLE — layout, not paint, which recipes never own.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';

const anatomy = anatomies.progress;

type ProgressState = 'loading' | 'complete' | 'indeterminate';

interface ProgressContext {
    state(): ProgressState;
    /** 0..100, clamped; 30 while indeterminate (the resting arc's sweep). */
    percent(): number;
}

const useProgressContext = defineInjectable<ProgressContext>(() => ({
    state: () => 'indeterminate',
    percent: () => 30,
}));

export type ProgressRootProps =
    /** Current value; `null` renders indeterminate. */
    & Define.Prop<'value', number | null, false>
    & Define.Prop<'max', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const ProgressRoot = component<ProgressRootProps>(({ props, slots }) => {
    // A non-finite or non-positive max cannot produce a meaningful ratio —
    // fall back to the default rather than emitting `NaN%` into a width.
    const max = () => {
        const raw = props.max ?? 100;
        return Number.isFinite(raw) && raw > 0 ? raw : 100;
    };
    const finiteValue = (): number | null => {
        if (props.value === null || props.value === undefined) return null;
        return Number.isFinite(props.value) ? props.value : null;
    };
    const state = (): ProgressState => {
        const value = finiteValue();
        if (value === null) return 'indeterminate';
        return value >= max() ? 'complete' : 'loading';
    };
    const percent = (): number => {
        const value = finiteValue();
        if (value === null) return 30;
        return Math.min(100, Math.max(0, (value / max()) * 100));
    };
    const axes = (): VariantAxes => ({ color: props.color, size: props.size, variant: props.variant });
    provideVariantAxes(axes);
    defineProvide(useProgressContext, () => ({ state, percent }));

    return () => (
        <view {...partBag(anatomy, 'root', { state: state(), ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Progress.Root' });

type PlainPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const ProgressLabel = component<PlainPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'label', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Progress.Label' });

const ProgressTrack = component<PlainPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'track', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Progress.Track' });

const ProgressRange = component<Define.Prop<'class', string, false>>(({ props }) => {
    const progress = useProgressContext();
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'range', { state: progress.state(), ...partAxes(axes()), class: props.class })}
            // Inline layout, not paint: the reveal the web recipe drives via
            // the runtime-published --progress-percent (web-only mechanism).
            style={{ width: `${progress.percent()}%` }}
        />
    );
}, { name: 'Progress.Range' });

const ProgressValueText = component<PlainPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'value-text', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Progress.ValueText' });

export const Progress = compound(ProgressRoot, {
    Root: ProgressRoot,
    Label: ProgressLabel,
    Track: ProgressTrack,
    Range: ProgressRange,
    ValueText: ProgressValueText,
});
