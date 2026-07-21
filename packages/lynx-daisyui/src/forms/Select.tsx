import {
  component,
  signal,
  useMainThreadRef,
  runOnBackground,
  type Define,
  type MainThread,
} from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant } from '@sigx/lynx-zero';
import { placeSelectDropdown, type TriggerFrame } from './select-position.js';

export type SelectSize = 'xs' | 'sm' | 'md' | 'lg';
export type SelectVariant = 'bordered' | 'ghost';
export type SelectColor = Exclude<ColorVariant, 'neutral'>;

export interface SelectOption {
  label: string;
  value: string;
}

export type SelectProps =
  & Define.Prop<'options', SelectOption[], false>
  & Define.Prop<'value', string, false>
  & Define.Prop<'placeholder', string, false>
  & Define.Prop<'size', SelectSize, false>
  & Define.Prop<'variant', SelectVariant, false>
  & Define.Prop<'color', SelectColor, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  // Two-way binding (the sigx way): `model={() => state.country}`. Picking an
  // option writes its value into the model. The static `value` prop is honored
  // when no model is bound (controlled/showcase rows).
  & Define.Model<string>
  /**
   * Fired with the picked option's value. A **plain function prop**, not an
   * `emit` event: a prop named `value` shadows `@sigx/runtime-core`'s emit
   * handler lookup, so events never fire on this component (#323). Use it for
   * controlled, non-`model` usage — or alongside `model`, which is still the
   * canonical state path and is written first.
   */
  & Define.Prop<'onChange', (value: string) => void, false>;

// Only one dropdown is open at a time across the whole tree. Each instance
// claims a unique id and the shared signal holds whichever is currently open,
// so opening one select collapses any other (no stacked/sticky menus).
let nextSelectId = 0;
const openSelectId = signal<number | null>(null);

// `lynx.SystemInfo` is populated on the main thread (it's empty on the BG
// thread), so the screen height is read inside the main-thread tap handler.
declare const lynx:
  | { SystemInfo?: { pixelHeight?: number; pixelRatio?: number } }
  | undefined;

export const Select = component<SelectProps>(({ props }) => {
  const id = nextSelectId++;
  const isOpen = () => openSelectId.value === id;

  // Measured on every open via `boundingClientRect` (viewport-relative) on the
  // main thread — `bindlayoutchange` reports offset-parent-relative coords,
  // which mis-anchors a `position: fixed` menu inside a scroll view.
  const triggerRef = useMainThreadRef<MainThread.Element | null>(null);
  // One object signal (sigx object signals are accessed by property, no
  // `.value`) holding the last-measured trigger frame and screen height.
  const measured = signal({ frame: null as TriggerFrame | null, screenHeight: 800 });

  // Resolved selection: the bound model wins, else the static `value` prop.
  const selectedValue = () => (props.model ? props.model.value : props.value);

  const getClasses = () => {
    const c = ['select'];
    if (props.variant === 'bordered') c.push('select-bordered');
    if (props.variant === 'ghost') c.push('select-ghost');
    if (props.color) c.push(`select-${props.color}`);
    if (props.size) c.push(`select-${props.size}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  const getSelectedLabel = () => {
    const opts = props.options ?? [];
    const found = opts.find((o) => o.value === selectedValue());
    return found ? found.label : (props.placeholder ?? 'Select...');
  };

  const options = () => props.options ?? [];

  const renderOption = (option: SelectOption) => (
    <Pressable
      class={`select-option${option.value === selectedValue() ? ' select-option-active' : ''}`}
      pressedScale={PRESSED_SCALE}
      pressedOpacity={PRESSED_OPACITY}
      longPressDuration={0}
      onPress={() => {
        // Model first (canonical state), then notify — so an `onChange`
        // reading the bound signal sees the new value already committed.
        if (props.model) props.model.value = option.value;
        props.onChange?.(option.value);
        openSelectId.value = null;
      }}
    >
      <text>{option.label}</text>
    </Pressable>
  );

  // Main-thread tap: measure the trigger's viewport rect + read the screen
  // height (both only reliable here), then hop to BG to stash them and toggle
  // open. Measuring and toggling in the same BG callback means the placement
  // is always ready on the first open — no null-frame flash.
  const onTriggerTap = () => {
    'main thread';
    const el = triggerRef.current;
    const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
    const px = info?.pixelHeight;
    const sh = typeof px === 'number' && px > 0 ? Math.round(px / (info?.pixelRatio || 1)) : 800;
    const apply = (rect: TriggerFrame | null) => {
      runOnBackground((r: TriggerFrame | null, h: number) => {
        measured.frame = r;
        measured.screenHeight = h;
        openSelectId.value = openSelectId.value === id ? null : id;
      })(rect, sh);
    };
    const rectP = el ? (el.invoke('boundingClientRect', {}) as unknown) : null;
    if (rectP && typeof (rectP as Promise<unknown>).then === 'function') {
      (rectP as Promise<TriggerFrame>).then(apply).catch(() => apply(null));
    } else {
      apply(null);
    }
  };

  return () => {
    const open = isOpen() && !props.disabled;
    const frame = measured.frame;
    const pos = open && frame
      ? placeSelectDropdown({
          trigger: frame,
          screenHeight: measured.screenHeight,
          optionCount: options().length,
        })
      : null;

    return (
      <view style={{ opacity: props.disabled ? 0.5 : 1 }}>
        <view
          class={getClasses()}
          main-thread:ref={triggerRef}
          main-thread:bindtap={props.disabled ? undefined : onTriggerTap}
          accessibility-element={true}
          accessibility-label={getSelectedLabel()}
          accessibility-trait="button"
        >
          <text>{getSelectedLabel()}</text>
          <view style={{ marginLeft: 'auto' }}><text>{open ? '▲' : '▼'}</text></view>
        </view>

        {/* Floating menu: `position: fixed` lifts it out of the scroll view so
            it can never be clipped at the screen edge, anchored to the measured
            trigger frame and flipped above when there isn't room below. A
            full-screen backdrop catches outside taps to close. */}
        {open && pos && [
          <view
            key="backdrop"
            bindtap={() => { openSelectId.value = null; }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 49 }}
          />,
          <view
            key="menu"
            class="select-dropdown"
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              ...(pos.top !== undefined ? { top: pos.top } : {}),
              ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
              maxHeight: pos.maxHeight,
              zIndex: 50,
            }}
          >
            <scroll-view scroll-orientation="vertical" style={{ maxHeight: pos.maxHeight }}>
              {options().map(renderOption)}
            </scroll-view>
          </view>,
        ]}

        {/* Fallback if the rect couldn't be measured (invoke unsupported):
            render the menu in-flow so the options still appear. */}
        {open && !pos && (
          <view class="select-dropdown" style={{ marginTop: 4 }}>
            {options().map(renderOption)}
          </view>
        )}
      </view>
    );
  };
});
