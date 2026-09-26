/**
 * Progress — the pilot's first component on purpose: pure paint, no
 * interaction, so it proves the whole pipeline (anatomy → partBag classes →
 * compiled skin CSS → themed literals) with nothing else in the frame.
 *
 * Zero's state semantics (0.6), verbatim: `value: null` is `indeterminate`;
 * otherwise the filled share of `[min, max]` decides — 100% is `complete`,
 * anything less is `loading`. A degenerate range (`max <= min`) has nothing
 * left to fill, so any present value reads as done. One divergence by
 * construction: the web recipe reads the runtime-published
 * `--progress-percent` for the range's width; that mechanism is web-only
 * (`RUNTIME_PROPERTIES`), so here the range's width is an INLINE STYLE —
 * layout, not paint, which recipes never own. An indeterminate range gets
 * no inline width at all, exactly like the web: the skin's own
 * `indeterminate` rule sizes and animates the sweep.
 *
 * What is announced is what is shown (zero#317): the root's accessibility
 * label and the default `ValueText` are one string — `getValueText` when
 * given, else the filled share as a whole percent (`Intl.NumberFormat`
 * with `locale`/`formatOptions` where the engine has it).
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.progress;

type ProgressState = 'loading' | 'complete' | 'indeterminate';

/** What `getValueText` is told besides the (clamped) value — zero's shape. */
export interface ProgressValueTextDetails {
    min: number;
    max: number;
    /** The filled share, 0–100. */
    percent: number;
}

export type ProgressGetValueText = (value: number, details: ProgressValueTextDetails) => string;

interface ProgressContext {
    state(): ProgressState;
    /** 0..100, clamped; `null` while indeterminate (no inline width). */
    percent(): number | null;
    /** The shown and announced value text; `undefined` while indeterminate. */
    valueText(): string | undefined;
}

const useProgressContext = defineInjectable<ProgressContext>(() => ({
    state: () => 'indeterminate',
    percent: () => null,
    valueText: () => undefined,
}));

/**
 * The value text for a determinate value, or `undefined` for an
 * indeterminate one. Mirrors zero's `progressValueText`: a percent style
 * formats the filled fraction, any other style the value itself. Lynx's
 * background-thread engines do not all ship `Intl`, so without it the
 * default is the whole percent, `"62%"`.
 */
function progressValueText(
    options: { getValueText?: ProgressGetValueText; locale?: string; formatOptions?: Intl.NumberFormatOptions },
    value: number | null,
    percent: number | null,
    min: number,
    max: number,
): string | undefined {
    if (value === null || percent === null) return undefined;
    if (options.getValueText) return options.getValueText(value, { min, max, percent });
    const formatOptions: Intl.NumberFormatOptions = { style: 'percent', ...options.formatOptions };
    const isPercent = formatOptions.style === 'percent';
    if (typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function') {
        try {
            return new Intl.NumberFormat(options.locale, formatOptions).format(isPercent ? percent / 100 : value);
        } catch {
            // A malformed option set, or a partial Intl — fall through.
        }
    }
    return isPercent ? `${Math.round(percent)}%` : String(value);
}

export type ProgressRootProps =
    /** Current value; `null` renders indeterminate. */
    & Define.Prop<'value', number | null, false>
    & Define.Prop<'min', number, false>
    & Define.Prop<'max', number, false>
    /** Replaces the default formatter: the string is both announced and shown. */
    & Define.Prop<'getValueText', ProgressGetValueText, false>
    /** BCP 47 locale for the default formatter (where the engine has `Intl`). */
    & Define.Prop<'locale', string, false>
    /** `Intl.NumberFormat` options, merged over `{ style: 'percent' }`. */
    & Define.Prop<'formatOptions', Intl.NumberFormatOptions, false>
    /** Accessible name — the visible `Label` slot is separate. */
    & Define.Prop<'label', string, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const finite = (raw: number | undefined, fallback: number): number =>
    typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;

const ProgressRoot = component<ProgressRootProps>(({ props, slots }) => {
    const min = () => finite(props.min, 0);
    const max = () => finite(props.max, 100);
    const finiteValue = (): number | null => {
        if (props.value === null || props.value === undefined) return null;
        return Number.isFinite(props.value) ? props.value : null;
    };
    const percent = (): number | null => {
        const value = finiteValue();
        if (value === null) return null;
        // Degenerate range: nothing left to fill — done, and no NaN width.
        const span = max() - min();
        if (!(span > 0)) return 100;
        return Math.min(100, Math.max(0, ((value - min()) / span) * 100));
    };
    const state = (): ProgressState => {
        const p = percent();
        if (p === null) return 'indeterminate';
        return p >= 100 ? 'complete' : 'loading';
    };
    const valueText = (): string | undefined => {
        const value = finiteValue();
        const clamped = value === null ? null : Math.min(Math.max(value, min()), Math.max(min(), max()));
        return progressValueText(props, clamped, percent(), min(), max());
    };
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size, variant: props.variant }));
    defineProvide(useProgressContext, () => ({ state, percent, valueText }));

    return () => (
        <view
            {...partBag(anatomy, 'root', { state: state(), ...partAxes(axes()), class: props.class })}
            {...partA11y({
                label: [props.label, valueText() ?? (state() === 'indeterminate' ? 'in progress' : undefined)]
                    .filter(Boolean).join(', ') || undefined,
            })}
        >
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
            // Indeterminate writes none — the skin's rule owns the sweep.
            style={progress.percent() === null ? undefined : { width: `${progress.percent()}%` }}
        />
    );
}, { name: 'Progress.Range' });

const ProgressValueText = component<PlainPartProps>(({ props, slots }) => {
    const progress = useProgressContext();
    const axes = useVariantAxes();
    // No slot: the formatted value — the same string the root announces.
    return () => (
        <text {...partBag(anatomy, 'value-text', { ...partAxes(axes()), class: props.class })}>
            {slots.default ? slots.default() : (progress.valueText() ?? '')}
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
