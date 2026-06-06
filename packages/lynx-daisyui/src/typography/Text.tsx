import { component, type Define } from '@sigx/lynx';

export type TextSize = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
export type TextWeight = 'light' | 'normal' | 'medium' | 'semibold' | 'bold';
export type TextColor = 'base-content' | 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error';

/** One `line-range()` entry for `TextAutoSize.lineRanges` (Lynx 3.8+). */
export interface TextAutoSizeLineRange {
  /**
   * Line count this range applies to — a number for an exact count, or
   * `[n, 'infinity']` for "n lines and up".
   */
  lines: number | readonly [number, 'infinity'];
  /** Minimum font size for this line count (CSS length, e.g. `'14px'`). */
  min: string;
  /** Maximum font size. Omit for a fixed size (max defaults to `min`). */
  max?: string;
}

/**
 * Auto font-size tuning. Maps to Lynx's `-x-auto-font-size` CSS property
 * family. Native precedence when several are given: `lineRanges` overrides
 * `presets`, which overrides `min`/`max`/`step`.
 */
export interface TextAutoSize {
  /** Minimum font size (CSS length, e.g. `'14px'`). */
  min?: string;
  /** Maximum font size. Positional in CSS — requires `min`. */
  max?: string;
  /** Adjustment granularity (Lynx default `1px`). Requires `max`. */
  step?: string;
  /**
   * Discrete candidate sizes; the largest that fits the width constraint
   * wins. Maps to `-x-auto-font-size-preset-sizes`.
   */
  presets?: readonly string[];
  /**
   * Per-line-count size ranges — shrink the font as the text wraps onto
   * more lines. Maps to `-x-auto-font-size-line-ranges`. Lynx 3.8+.
   */
  lineRanges?: readonly TextAutoSizeLineRange[];
}

export type TextProps =
  & Define.Prop<'size', TextSize, false>
  & Define.Prop<'weight', TextWeight, false>
  & Define.Prop<'color', TextColor, false>
  & Define.Prop<'class', string, false>
  /**
   * Allow native text selection (long-press to select, system copy menu).
   * Maps to Lynx 3.7+'s `text-selection` attribute and sets
   * `flatten={false}` (required by Lynx for selection to work). Lynx 3.8
   * fixed a crash when the selection handlebars overlapped.
   */
  & Define.Prop<'selectable', boolean, false>
  /**
   * When `selectable` is enabled, disable Lynx's built-in selection
   * handling entirely so the app can drive selection itself (e.g. via
   * `setTextSelection`). Maps to Lynx 3.7+'s `custom-text-selection`.
   */
  & Define.Prop<'customSelection', boolean, false>
  /**
   * Auto-shrink (or grow) the font to fit. `true` enables Lynx's
   * `-x-auto-font-size` with native defaults; an object tunes the range,
   * preset sizes, or per-line-count ranges (`lineRanges`, Lynx 3.8+).
   * The `size` prop / `text-*` class still sets the starting font size.
   */
  & Define.Prop<'autoSize', boolean | TextAutoSize, false>
  & Define.Slot<'default'>;

const sizeClasses: Record<TextSize, string> = {
  xs: 'text-xs', sm: 'text-sm', base: 'text-base', lg: 'text-lg',
  xl: 'text-xl', '2xl': 'text-2xl', '3xl': 'text-3xl',
};

const weightClasses: Record<TextWeight, string> = {
  light: 'font-light', normal: 'font-normal', medium: 'font-medium',
  semibold: 'font-semibold', bold: 'font-bold',
};

// A `text-<size>` font-size utility already present in `class` (the common
// `class="text-sm"` override idiom). The trailing `(?![\w-])` guard excludes
// color tokens like `text-base-content`, so they don't suppress the default.
const SIZE_IN_CLASS =
  /(?:^|\s)text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)(?![\w-])/;

function lineRangeValue(r: TextAutoSizeLineRange): string {
  const lines = typeof r.lines === 'number' ? `${r.lines}` : `${r.lines[0]} to infinity`;
  return r.max ? `line-range(${lines}, ${r.min}, ${r.max})` : `line-range(${lines}, ${r.min})`;
}

/**
 * Build the `-x-auto-font-size*` inline-style entries. The base property's
 * value is positional (`true <min> <max> <step>`), so `max` is only emitted
 * when `min` is present and `step` only when `max` is.
 */
function autoSizeStyle(autoSize: boolean | TextAutoSize): Record<string, string> | undefined {
  if (!autoSize) return undefined;
  let base = 'true';
  const style: Record<string, string> = {};
  if (autoSize !== true) {
    if (autoSize.min) {
      base += ` ${autoSize.min}`;
      if (autoSize.max) {
        base += ` ${autoSize.max}`;
        if (autoSize.step) base += ` ${autoSize.step}`;
      }
    }
    if (autoSize.presets?.length) {
      style['-x-auto-font-size-preset-sizes'] = autoSize.presets.join(' ');
    }
    if (autoSize.lineRanges?.length) {
      style['-x-auto-font-size-line-ranges'] = autoSize.lineRanges.map(lineRangeValue).join(', ');
    }
  }
  style['-x-auto-font-size'] = base;
  return style;
}

export const Text = component<TextProps>(({ props, slots }) => {
  const getClasses = () => {
    const c: string[] = [];
    // Defined default: `base` (--text-base, 17px) so text has a token-driven
    // size instead of Lynx's native <text> default — unless the caller set an
    // explicit `size` prop or already passed a `text-*` size through `class`
    // (avoids emitting two conflicting font-size utilities).
    if (props.size) c.push(sizeClasses[props.size]);
    else if (!(props.class && SIZE_IN_CLASS.test(props.class))) c.push(sizeClasses.base);
    if (props.weight) c.push(weightClasses[props.weight]);
    if (props.color) c.push(`text-${props.color}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => (
    <text
      class={getClasses()}
      style={props.autoSize != null ? autoSizeStyle(props.autoSize) : undefined}
      text-selection={props.selectable}
      custom-text-selection={props.customSelection}
      flatten={props.selectable ? false : undefined}
    >
      {slots.default?.()}
    </text>
  );
});
