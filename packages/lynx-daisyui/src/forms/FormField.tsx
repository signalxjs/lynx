import { component, type Define } from '@sigx/lynx';

export type FormFieldProps =
  & Define.Prop<'label', string, false>
  & Define.Prop<'error', string, false>
  & Define.Prop<'required', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const FormField = component<FormFieldProps>(({ props, slots }) => {
  return () => (
    <view class={['form-control', props.class].filter(Boolean).join(' ')} style={{ gap: 4 }}>
      {props.label && (
        <view class="label">
          <text class="label-text">
            {props.required ? `${props.label} *` : props.label}
          </text>
        </view>
      )}
      {slots.default?.()}
      {props.error && (
        <view class="label">
          <text class="label-text-error">
            {props.error}
          </text>
        </view>
      )}
    </view>
  );
});
