import { component, type Define } from '@sigx/lynx';
import type { SizeScale } from '@sigx/lynx-zero';

export type AvatarSize = SizeScale;

export type AvatarProps =
  & Define.Prop<'src', string, false>
  & Define.Prop<'size', AvatarSize, false>
  /** `true`/`'full'` = circle; otherwise the hero rounded-square radius. */
  & Define.Prop<'rounded', boolean | 'full', false>
  & Define.Prop<'placeholder', string, false>
  & Define.Prop<'class', string, false>;

const sizeMap: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 48, lg: 64, xl: 96 };
const fontMap: Record<AvatarSize, number> = { xs: 10, sm: 12, md: 18, lg: 24, xl: 36 };

export const Avatar = component<AvatarProps>(({ props }) => {
  return () => {
    const size = props.size ?? 'md';
    const dim = sizeMap[size];
    const circle = props.rounded === 'full' || props.rounded === true;
    const borderRadius = circle ? dim / 2 : 12;
    const inner: Record<string, string | number> = {
      width: dim, height: dim, borderRadius,
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
    };

    if (props.src) {
      return (
        <view class={`hero-avatar${props.class ? ' ' + props.class : ''}`}>
          <view style={inner}>
            <image src={props.src} style={{ width: dim, height: dim, borderRadius }} />
          </view>
        </view>
      );
    }

    return (
      <view class={`hero-avatar${props.class ? ' ' + props.class : ''}`}>
        <view class="hero-avatar-placeholder" style={inner}>
          <text class="hero-avatar-initials" style={{ fontSize: fontMap[size] }}>{props.placeholder ?? '?'}</text>
        </view>
      </view>
    );
  };
});
