import { component, type Define } from '@sigx/lynx';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type AvatarProps =
  & Define.Prop<'src', string, false>
  & Define.Prop<'size', AvatarSize, false>
  & Define.Prop<'rounded', boolean | 'full', false>
  & Define.Prop<'placeholder', string, false>
  & Define.Prop<'online', boolean, false>
  & Define.Prop<'offline', boolean, false>
  & Define.Prop<'class', string, false>;

const sizeMap: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 48,
  lg: 64,
  xl: 96,
};

const fontSizeMap: Record<AvatarSize, number> = {
  xs: 10,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 36,
};

export const Avatar = component<AvatarProps>(({ props }) => {
  return () => {
    const size = props.size || 'md';
    const dim = sizeMap[size];

    const classes: string[] = ['avatar'];
    if (props.online) classes.push('online');
    if (props.offline) classes.push('offline');
    if (props.placeholder && !props.src) classes.push('placeholder');
    if (props.class) classes.push(props.class);

    const rounded = props.rounded;
    const borderRadius = rounded === 'full' || rounded === true ? dim / 2 : 8;

    const innerStyle = {
      width: dim,
      height: dim,
      borderRadius,
      overflow: 'hidden' as any,
      alignItems: 'center',
      justifyContent: 'center',
      display: 'flex',
    };

    if (props.src) {
      return (
        <view class={classes.join(' ')}>
          <view style={innerStyle}>
            <image
              src={props.src}
              style={{ width: dim, height: dim, borderRadius }}
            />
          </view>
        </view>
      );
    }

    return (
      <view class={classes.join(' ')}>
        <view class="avatar-placeholder" style={innerStyle}>
          <text style={{ fontSize: fontSizeMap[size] }}>{props.placeholder || '?'}</text>
        </view>
      </view>
    );
  };
});
