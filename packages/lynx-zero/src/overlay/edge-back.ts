/**
 * The iOS system back gesture while an overlay is open (#1312).
 *
 * iOS has no back button. Its system back is a swipe in from the left
 * edge, which lynx-navigation's `<Stack>` implements as an edge strip on
 * the screen. The overlay outlet paints above the whole page, though, so
 * while a layer is open every touch at the edge lands on that layer (a
 * modal backdrop, a popover's outside surface) and the navigator never
 * sees the swipe. The user could neither close the layer by swiping nor go
 * back.
 *
 * The outlet therefore carries its own edge strip, above every layer, while
 * a dismiss layer is open on the screen on top. A swipe on it is a back
 * press: it goes to the same back interceptors Android's back button
 * reaches (`dispatchBackInterceptors`), so the innermost dismissible layer
 * closes, and a non-dismissible one keeps the swipe without closing, as a
 * back press does on Android. A non-dismissible layer never traps the
 * user: it renders its own way out (a dialog's action buttons), and its
 * screen is covered or popped normally once that way out is taken.
 *
 * iOS only. Android's back gesture is the platform's and reaches the same
 * interceptors through `hardwareBackPress`; the web has Escape.
 */
import { Platform } from '@sigx/lynx';

/** Width of the touchable strip, matching lynx-navigation's edge strip. */
export const EDGE_BACK_WIDTH = 20;
/** Horizontal travel (px) a release needs to count as a back swipe. */
export const EDGE_BACK_MIN_TRAVEL = 40;

let enabled = Platform.OS === 'ios';

/** Whether this platform's back gesture is the edge swipe (iOS). */
export function edgeBackEnabled(): boolean {
    return enabled;
}

/** @internal — test seam: force the platform gate. Returns the restore. */
export function setEdgeBackEnabledForTest(value: boolean): () => void {
    const prev = enabled;
    enabled = value;
    return () => {
        enabled = prev;
    };
}

/** The point a lynx touch event carries, whichever field this engine fills. */
interface TouchPoint {
    pageX?: number;
    pageY?: number;
    clientX?: number;
    clientY?: number;
    x?: number;
    y?: number;
}

interface TouchEventLike {
    touches?: TouchPoint[];
    changedTouches?: TouchPoint[];
    detail?: TouchPoint;
}

function pointOf(e: unknown): { x: number; y: number } | null {
    const ev = (e ?? {}) as TouchEventLike;
    const t = ev.changedTouches?.[0] ?? ev.touches?.[0] ?? ev.detail;
    if (!t) return null;
    const x = t.pageX ?? t.clientX ?? t.x;
    const y = t.pageY ?? t.clientY ?? t.y;
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

export interface EdgeSwipeHandlers {
    start(e: unknown): void;
    move(e: unknown): void;
    end(e: unknown): void;
    cancel(): void;
}

/**
 * Touch handlers that call `onSwipe` once per rightward, mostly horizontal
 * swipe of at least `EDGE_BACK_MIN_TRAVEL`. Pure BG logic: the strip is
 * narrow and fires one decision per gesture, so no main-thread worklet is
 * needed.
 */
export function createEdgeSwipe(onSwipe: () => void): EdgeSwipeHandlers {
    let origin: { x: number; y: number } | null = null;
    let last: { x: number; y: number } | null = null;
    return {
        start(e) {
            origin = pointOf(e);
            last = origin;
        },
        move(e) {
            last = pointOf(e) ?? last;
        },
        end(e) {
            const from = origin;
            const to = pointOf(e) ?? last;
            origin = null;
            last = null;
            if (!from || !to) return;
            const dx = to.x - from.x;
            const dy = Math.abs(to.y - from.y);
            if (dx >= EDGE_BACK_MIN_TRAVEL && dx > dy) onSwipe();
        },
        cancel() {
            origin = null;
            last = null;
        },
    };
}
