import { component, signal, useElementLayout, useSharedValue } from '@sigx/lynx';
import { useNav, useParams, Screen } from '@sigx/lynx-navigation';
import { Swiper } from '@sigx/lynx-gestures';
import { SwiperIndicator } from '@sigx/lynx-daisyui';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import { getEntry } from '../store/trips.js';

// Read screen dimensions once at module load — used as the first-paint
// fallback before the viewer's own `useElementLayout` reports the actual
// container size. The modal Layer may be narrower than the physical screen
// (e.g. on tablets / split layouts) so we measure live as soon as we can.
declare const lynx:
    | { SystemInfo?: { pixelWidth?: number; pixelHeight?: number; pixelRatio?: number } }
    | undefined;

const SCREEN_WIDTH_FALLBACK = (() => {
    try {
        const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
        const px = info?.pixelWidth;
        const pr = info?.pixelRatio || 1;
        if (typeof px === 'number' && px > 0) return Math.round(px / pr);
    } catch { /* ignore */ }
    return 400;
})();

const SCREEN_HEIGHT_FALLBACK = (() => {
    try {
        const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
        const px = info?.pixelHeight;
        const pr = info?.pixelRatio || 1;
        if (typeof px === 'number' && px > 0) return Math.round(px / pr);
    } catch { /* ignore */ }
    return 800;
})();

/**
 * Fullscreen image swiper. Presented over the trip detail as a
 * `presentation: 'fullScreen'` route so it covers the screen completely
 * (including any tab bar) and gets its own backdrop. Tap anywhere outside
 * the dots pops back to the trip; horizontal swipe pages through photos.
 *
 * Pinch-to-zoom is intentionally deferred — the JS-only `usePinch` hook
 * conflicts with the underlying scroll-view's pan recognizer. Reintroduce
 * once Lynx ships an arena-side `Gesture.Pinch()` handler.
 */
export const ImageViewer = component(() => {
    const nav = useNav();
    const { tripId, entryId, index } = useParams('imageViewer');
    const entry = getEntry(tripId, entryId);
    const photos = entry?.photoUris ?? [];

    // Live MT-thread pixel offset — drives the dots indicator. Allocated
    // unconditionally per hooks rules; the empty-photos branch below
    // simply doesn't render the swiper.
    const offset = useSharedValue(0);

    // Current page index — a plain sigx signal so writes glide the swiper
    // (effect inside <Swiper /> bridges to the native scroll-view).
    const initial = typeof index === 'number' ? index : 0;
    const pageIdx = signal(initial);

    // Measure the host modal box. Lynx horizontal `<scroll-view>` children
    // need explicit pixel dimensions, so we read the layer's actual
    // CSS-pixel size and hand it to the Swiper. Falls back to screen size
    // for first paint before layout fires.
    const { layout, onLayoutChange } = useElementLayout();

    const insets = useSafeAreaInsets();

    return () => {
        const initialIndex = initial;
        const topInset = insets.value.top;
        const width = layout.value && layout.value.width > 0
            ? layout.value.width
            : SCREEN_WIDTH_FALLBACK;
        const height = layout.value && layout.value.height > 0
            ? layout.value.height
            : SCREEN_HEIGHT_FALLBACK;

        if (photos.length === 0) {
            return (
                <view class="flex-fill" style={{ backgroundColor: '#000' }}>
                    <Screen title="" headerShown={false} />
                </view>
            );
        }

        return (
            <view
                class="flex-fill"
                style={{ backgroundColor: '#000', position: 'relative' }}
                bindlayoutchange={onLayoutChange}
                bindtap={() => nav.pop()}
            >
                <Screen title="" headerShown={false} />
                <Swiper
                    offset={offset}
                    index={pageIdx}
                    initialIndex={initialIndex}
                    items={photos}
                    width={width}
                    height={height}
                    style={{ width: width + 'px', height: height + 'px' }}
                    renderItem={(uri) => (
                        <image
                            src={uri}
                            mode="aspectFit"
                            style={{ width: width + 'px', height: height + 'px' }}
                        />
                    )}
                />
                {photos.length > 1
                    ? (
                        <view
                            style={{
                                position: 'absolute',
                                bottom: '32px',
                                left: '0',
                                right: '0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <SwiperIndicator
                                variant="dots"
                                count={photos.length}
                                offset={offset}
                                pageWidth={width}
                                index={pageIdx}
                                color="base-100"
                                inactiveColor="base-content"
                                size="md"
                                onDotPress={(i) => { pageIdx.value = i; }}
                            />
                        </view>
                    )
                    : null}
                <view
                    catchtap={() => nav.pop()}
                    style={{
                        position: 'absolute',
                        top: (topInset + 16) + 'px',
                        right: '16px',
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    accessibility-element={true}
                    accessibility-label="Close"
                    accessibility-trait="button"
                >
                    <text style={{ color: '#fff', fontSize: 18, lineHeight: 36 }}>×</text>
                </view>
            </view>
        );
    };
});
