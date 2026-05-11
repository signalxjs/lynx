import { component, type Define } from '@sigx/lynx';

export type ToggleColor = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error';
export type ToggleSize = 'xs' | 'sm' | 'md' | 'lg';

export type ToggleProps =
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', ToggleColor, false>
  & Define.Prop<'size', ToggleSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Event<'change', boolean>;

const thumbOffsetMap: Record<ToggleSize, number> = {
  xs: 10, sm: 16, md: 20, lg: 24,
};

export const Toggle = component<ToggleProps>(({ props, emit }) => {
  const getClasses = () => {
    const c = ['toggle'];
    const size = props.size ?? 'md';
    c.push(`toggle-${size}`);
    if (props.color) c.push(`toggle-${props.color}`);
    if (props.checked) c.push('toggle-checked');
    if (props.disabled) c.push('toggle-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const checked = !!props.checked;
    const size = props.size ?? 'md';
    const offset = checked ? thumbOffsetMap[size] : 0;

    return (
      <view
        class={getClasses()}
        bindtap={() => {
          if (!props.disabled) emit('change', !checked);
        }}
      >
        <view
          class="toggle-thumb"
          style={{ transform: `translateX(${offset}px)` }}
        />
      </view>
    );
  };
});
