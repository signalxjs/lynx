import { component, type Define } from '@sigx/lynx';

export type FormFieldProps =
  & Define.Prop<'label', string, false>
  & Define.Prop<'error', string, false>
  & Define.Prop<'required', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

/** Labelled field wrapper — label (+ required marker), the control slot, and
 *  an optional error line below. */
export const FormField = component<FormFieldProps>(({ props, slots }) => {
  return () => (
    <view class={['hero-form-field', props.class].filter(Boolean).join(' ')} style={{ gap: 4 }}>
      {props.label ? (
        <text class="hero-form-field-label">
          {props.required ? `${props.label} *` : props.label}
        </text>
      ) : null}
      {slots.default?.()}
      {props.error ? (
        <text class="hero-form-field-error">{props.error}</text>
      ) : null}
    </view>
  );
});
