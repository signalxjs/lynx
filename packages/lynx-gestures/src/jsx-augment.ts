/**
 * JSX intrinsic type augmentation for `<sigx-pinch>`.
 *
 * Importing this module registers `'sigx-pinch'` as a valid JSX intrinsic with
 * the prop + event surface implemented by `SigxPinchUI` (iOS) and
 * `SigxPinchUI.kt` / `SigxPinchView.kt` (Android). Pulled in automatically by
 * `@sigx/lynx-gestures`'s entry point so consumers don't import it directly.
 *
 * Element availability requires `sigx prebuild` to have run after adding this
 * package as a dependency — the autolinker emits the `LynxConfig` registration
 * (iOS) and `Behavior` attachment (Android) that bind the tag to the native UI
 * class. See `signalx-module.json`.
 *
 * Why native rather than `Gesture.Pinch()`: Lynx's gesture arena reserves the
 * PINCH/ROTATION enum slots but ships no handler for them in any released
 * version, and the handler factory is a closed switch compiled into the
 * framework. This element instead attaches UIKit's `UIPinch`/`UIRotation`
 * recognizers (iOS) and `ScaleGestureDetector` + a rotation tracker (Android)
 * to its own backing view and applies the transform on the UI thread.
 */
import type { LynxCommonAttributes, LynxEventHandler } from '@sigx/lynx-runtime';

export interface PinchGestureStartDetail {
    /** Focal point (midpoint of the two fingers), in element-local px. */
    focalX: number;
    focalY: number;
    [k: string]: unknown;
}
export interface PinchGestureStartEvent {
    type: 'gesturestart';
    detail: PinchGestureStartDetail;
}

export interface PinchGestureChangeDetail {
    /** Cumulative scale since the content's last reset (clamped to min/max). */
    scale: number;
    /** Cumulative rotation in **radians** (signed). */
    rotation: number;
    focalX: number;
    focalY: number;
    [k: string]: unknown;
}
export interface PinchGestureChangeEvent {
    type: 'gesturechange';
    detail: PinchGestureChangeDetail;
}

export interface PinchGestureEndDetail {
    scale: number;
    /** Cumulative rotation in **radians** (signed). */
    rotation: number;
    [k: string]: unknown;
}
export interface PinchGestureEndEvent {
    type: 'gestureend';
    detail: PinchGestureEndDetail;
}

export interface SigxPinchAttributes extends LynxCommonAttributes {
    /** Lower zoom bound. Default `1`. */
    'min-scale'?: number;
    /** Upper zoom bound. Default `4`. */
    'max-scale'?: number;
    /** Allow twist-to-rotate. Default `true`. */
    'enable-rotation'?: boolean;
    /** Master gesture switch. Default `true`. */
    enabled?: boolean;
    /**
     * Controlled scale. Drive the zoom programmatically (e.g. a slider on a
     * host without multi-touch); a following pinch composes on top. Clamped
     * to `min-scale`…`max-scale`.
     */
    scale?: number;
    /** Controlled rotation in **radians**. Companion to `scale`. */
    rotation?: number;
    /** Fires when the two-finger gesture begins. */
    bindgesturestart?: LynxEventHandler<PinchGestureStartEvent>;
    /** Fires every frame the pinch/rotation updates. */
    bindgesturechange?: LynxEventHandler<PinchGestureChangeEvent>;
    /** Fires when the last of the two fingers lifts. */
    bindgestureend?: LynxEventHandler<PinchGestureEndEvent>;
    /** Slotted content that gets pinched/rotated. */
    children?: unknown;
}

/**
 * Attributes for `<sigx-touch-guard>` — an overlay container whose Android
 * backing view CONSUMES the platform touch stream (#787).
 *
 * A Lynx `catchtap` overlay blocks Lynx-level handlers beneath it, but on
 * Android the raw platform touch still falls through to native views — an
 * EditText under the dim grabs focus + keyboard. This element's native view
 * claims the touch target at ACTION_DOWN so the stream never reaches native
 * siblings underneath, while `catchtap` on the element itself (and its Lynx
 * children) keeps firing. iOS and web don't leak platform touches; the tag
 * exists there for symmetry (guard-enabled is an accepted no-op).
 *
 * All the usual overlay attrs (`catchtap`, `ignore-focus`, `flatten`,
 * `class`, `style`, `main-thread:ref`) come from [LynxCommonAttributes].
 */
export interface SigxTouchGuardAttributes extends LynxCommonAttributes {
    /**
     * Consume the platform touch stream (default `true`). When `false` the
     * element dispatches like a plain `<view>`.
     */
    'guard-enabled'?: boolean;
    /** Slotted overlay content. */
    children?: unknown;
}

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'sigx-pinch': SigxPinchAttributes;
            'sigx-touch-guard': SigxTouchGuardAttributes;
        }
    }
}
