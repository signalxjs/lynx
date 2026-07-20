import { component, type Define } from '@sigx/lynx';
import '../jsx-augment.js';
import type {
  PinchGestureStartDetail,
  PinchGestureChangeDetail,
  PinchGestureEndDetail,
} from '../jsx-augment.js';

/**
 * Two-finger pinch-zoom + twist-rotate container, backed by the native
 * `<sigx-pinch>` element (UIKit `UIPinch`/`UIRotationGestureRecognizer` on
 * iOS, `ScaleGestureDetector` + a rotation tracker on Android).
 *
 * **The transform is applied natively**, on the platform UI thread — the
 * slotted content zooms and rotates with zero JS/thread round-trip, so it
 * stays smooth under the finger. Unlike the old `usePinch`/`useRotation` JS
 * hooks (which parsed `bindtouch*` on the background thread and matched
 * fingers by proximity), this uses the OS's first-class recognizers, so
 * multi-touch is reliable.
 *
 * The `change`/`start`/`end` events report the live scale/rotation for app
 * logic (a readout, persistence, haptics) — you do **not** need to apply the
 * transform yourself.
 *
 * ```tsx
 * <PinchRotate maxScale={5} onChange={(e) => scale.value = e.scale}>
 *   <image src="photo.jpg" style={{ width: '240px', height: '240px' }} />
 * </PinchRotate>
 * ```
 *
 * Requires `sigx prebuild` (the element is native). On hosts that don't
 * deliver multi-touch the content simply stays put — there's no JS fallback.
 */
export type PinchRotateProps =
  & Define.Prop<'minScale', number, false>
  & Define.Prop<'maxScale', number, false>
  & Define.Prop<'enableRotation', boolean, false>
  & Define.Prop<'enabled', boolean, false>
  /** Controlled scale (drive it from a signal/slider). */
  & Define.Prop<'scale', number, false>
  /** Controlled rotation in radians. */
  & Define.Prop<'rotation', number, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>
  /** Two-finger gesture began; detail is the focal point. */
  & Define.Event<'start', PinchGestureStartDetail>
  /** Live scale/rotation update (rotation in radians). */
  & Define.Event<'change', PinchGestureChangeDetail>
  /** Gesture finished; detail carries the resting scale/rotation. */
  & Define.Event<'end', PinchGestureEndDetail>;

export const PinchRotate = component<PinchRotateProps>(({ props, slots, emit }) => {
  return () => (
    <sigx-pinch
      min-scale={props.minScale ?? 1}
      max-scale={props.maxScale ?? 4}
      enable-rotation={props.enableRotation ?? true}
      enabled={props.enabled ?? true}
      scale={props.scale}
      rotation={props.rotation}
      class={props.class}
      style={props.style}
      bindgesturestart={(e) => emit('start', e.detail)}
      bindgesturechange={(e) => emit('change', e.detail)}
      bindgestureend={(e) => emit('end', e.detail)}
    >
      {slots.default?.()}
    </sigx-pinch>
  );
});
