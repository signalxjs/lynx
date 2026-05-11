import { component, type Define } from '@sigx/lynx';

export type ProgressColor = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error';

export type ProgressProps =
  & Define.Prop<'value', number, false>
  & Define.Prop<'max', number, false>
  & Define.Prop<'color', ProgressColor, false>
  & Define.Prop<'class', string, false>;

export const Progress = component<ProgressProps>(({ props }) => {
  const getClasses = () => {
    const c = ['progress'];
    if (props.color) c.push(`progress-${props.color}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const max = props.max ?? 100;
    const pct = Math.min(Math.max((props.value ?? 0) / max, 0), 1) * 100;

    return (
      <view class={getClasses()}>
        <view
          class="progress-bar"
          style={{ width: `${pct}%` }}
        />
      </view>
    );
  };
});
