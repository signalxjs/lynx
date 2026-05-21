/**
 * Reactive access to an element's measured layout via Lynx 3.7+'s generic
 * `bindlayoutchange` event. Pairs a signal that exposes the latest layout
 * with the event handler the caller wires on the JSX element.
 *
 * For text-specific line metrics (lineCount, line frames) wire the
 * `<text>`-only `bindlayout` event directly; its detail shape is
 * different (`TextLayoutEventDetail`).
 *
 * @example
 * ```tsx
 * const { layout, onLayoutChange } = useElementLayout();
 *
 * return () => (
 *   <view bindlayoutchange={onLayoutChange}>
 *     <text>width: {layout.value?.width ?? 0}</text>
 *   </view>
 * );
 * ```
 */
import { signal, type Signal } from '@sigx/reactivity';

export interface ElementLayout {
    /** Width in CSS pixels. */
    width: number;
    /** Height in CSS pixels. */
    height: number;
    /** Top edge relative to the page, in CSS pixels. */
    top: number;
    /** Right edge relative to the page, in CSS pixels. */
    right: number;
    /** Bottom edge relative to the page, in CSS pixels. */
    bottom: number;
    /** Left edge relative to the page, in CSS pixels. */
    left: number;
}

interface LayoutChangeDetail {
    id?: string;
    width: number;
    height: number;
    top: number;
    right?: number;
    bottom?: number;
    left: number;
}

export interface LayoutChangeEvent {
    type?: string;
    /** Modern, cross-platform payload (Android/iOS/Harmony/PC). */
    detail?: LayoutChangeDetail;
    /**
     * Deprecated Android-only payload. Engines that still emit `params` carry
     * the same numbers; this branch is kept so consumers on older clients keep
     * working.
     */
    params?: { width: number; height: number; left: number; top: number; right: number; bottom: number };
}

export interface UseElementLayoutResult {
    /** Latest measured layout, or `null` until the first event fires. */
    layout: Signal<{ value: ElementLayout | null }>;
    /** Wire on the JSX element: `bindlayoutchange={onLayoutChange}`. */
    onLayoutChange: (e: LayoutChangeEvent) => void;
}

export function useElementLayout(): UseElementLayoutResult {
    const layout: Signal<{ value: ElementLayout | null }> = signal({
        value: null as ElementLayout | null,
    });

    const onLayoutChange = (e: LayoutChangeEvent): void => {
        const d = e?.detail ?? e?.params;
        if (!d) return;
        layout.value = {
            width: d.width,
            height: d.height,
            top: d.top,
            right: d.right ?? d.left + d.width,
            bottom: d.bottom ?? d.top + d.height,
            left: d.left,
        };
    };

    return { layout, onLayoutChange };
}
