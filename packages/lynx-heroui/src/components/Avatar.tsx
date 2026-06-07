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
    // Circle radius is size-derived (must be inline). The rounded-square radius
    // comes from the theme token via `.hero-avatar-box` (inline style can't
    // resolve var() in this toolchain), so it follows hero theme radii.
    const radiusStyle: Record<string, number> = circle ? { borderRadius: dim / 2 } : {};
    const inner: Record<string, string | number> = {
      width: dim, height: dim,
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      ...radiusStyle,
    };

    if (props.src) {
      return (
        <view class={`hero-avatar${props.class ? ' ' + props.class : ''}`}>
          <view class="hero-avatar-box" style={inner}>
            <image src={props.src} class="hero-avatar-box" style={{ width: dim, height: dim, ...radiusStyle }} />
          </view>
        </view>
      );
    }

    return (
      <view class={`hero-avatar${props.class ? ' ' + props.class : ''}`}>
        <view class="hero-avatar-box hero-avatar-placeholder" style={inner}>
          <text class="hero-avatar-initials" style={{ fontSize: fontMap[size] }}>{props.placeholder ?? '?'}</text>
        </view>
      </view>
    );
  };
});
