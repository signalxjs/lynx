import { component, signal, useElementLayout, useSharedValue } from '@sigx/lynx';
import { useNav, useParams, Screen } from '@sigx/lynx-navigation';
import { Badge, Button, Card, Col, Row, ScrollView, SwiperIndicator, Text } from '@sigx/lynx-daisyui';
import { Swiper } from '@sigx/lynx-gestures';
import { Haptics } from '@sigx/lynx-haptics';
import { Share } from '@sigx/lynx-share';
import { Audio, type AudioHandle } from '@sigx/lynx-audio';
import { VideoPlayer } from '@sigx/lynx-video';
import { deleteEntry, getTrip, trips } from '../store/trips.js';
import type { Entry, Trip } from '../store/types.js';

function buildSummary(trip: Trip): string {
    if (trip.entries.length === 0) return `${trip.name}\n(no entries yet)`;
    const lines = trip.entries.map((e) => {
        const date = new Date(e.createdAt).toLocaleDateString();
        const where = e.coords ? ` @ ${e.coords.lat.toFixed(3)},${e.coords.lng.toFixed(3)}` : '';
        return `• ${date}${where} — ${e.note}`;
    });
    return `${trip.name}\n\n${lines.join('\n')}`;
}

/**
 * Per-entry photo block. Single image when there's one, paged `<Swiper>` +
 * dots when there are several. Each card needs its own MT-thread offset
 * `SharedValue`, hence the dedicated component (hooks must live at a stable
 * call-site — we can't `useSharedValue` inside the `map` callback).
 */
const EntryPhotos = component<{
    entry: Entry;
    onTap: (index: number) => void;
}>(({ props }) => {
    const offset = useSharedValue(0);
    // Track the currently visible page so tapping the strip opens the
    // viewer at the right photo, not always at index 0.
    const pageIdx = signal(0);
    // Measured page width — keeps `<Swiper>` and `<SwiperDots>` in sync
    // across device widths / orientation changes instead of a hard-coded
    // px value that only matches one specific layout.
    const { layout, onLayoutChange } = useElementLayout();
    return () => {
        const photos = props.entry.photoUris ?? [];
        if (photos.length === 0) return null;
        if (photos.length === 1) {
            return (
                <view bindtap={() => props.onTap(0)} style={{ marginBottom: 8 }}>
                    <image
                        src={photos[0]}
                        mode="aspectFill"
                        style={{ width: '100%', height: 180, borderRadius: 10 }}
                    />
                </view>
            );
        }
        return (
            <view style={{ marginBottom: 8 }}>
                <view
                    bindtap={() => props.onTap(pageIdx.value)}
                    bindlayoutchange={onLayoutChange}
                    style={{ width: '100%', height: 180 }}
                >
                    <Swiper
                        offset={offset}
                        index={pageIdx}
                        items={photos}
                        height={180}
                        style={{ width: '100%', height: '100%' }}
                        renderItem={(uri) => (
                            <image
                                src={uri}
                                mode="aspectFill"
                                style={{ width: '100%', height: '100%', borderRadius: 10 }}
                            />
                        )}
                    />
                </view>
                <view style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
                    <SwiperIndicator
                        variant="dots"
                        count={photos.length}
                        offset={offset}
                        pageWidth={layout.value?.width ?? 343}
                        index={pageIdx}
                        color="primary"
                        size="sm"
                        onDotPress={(i) => { pageIdx.value = i; }}
                    />
                </view>
            </view>
        );
    };
});

/**
 * Inline play/stop button for an entry's voice note. Holds its own
 * `AudioHandle` so multiple entry cards on the same screen each have an
 * independent player — taps on one card don't disturb another.
 */
const VoiceNoteButton = component<{ uri: string }>(({ props }) => {
    const handle = signal<{ value: AudioHandle | null }>({ value: null });
    const toggle = async () => {
        const existing = handle.value;
        if (existing) {
            try { await existing.stop(); } catch {}
            handle.value = null;
            return;
        }
        try {
            const h = await Audio.play(props.uri);
            handle.value = h;
            h.onEnd(() => { handle.value = null; });
        } catch (e) {
            console.warn('[TripDetail] voice note playback failed:', e);
        }
    };
    return () => (
        <Button size="xs" variant="primary" outline onPress={toggle}>
            {handle.value ? '■ Stop voice note' : '▶ Voice note'}
        </Button>
    );
});

export const TripDetail = component(() => {
    const nav = useNav();
    const { tripId } = useParams('tripDetail');

    return () => {
        // Reading from the trips proxy makes the screen reactive to entry adds.
        const trip = trips.find((t) => t.id === tripId);

        if (!trip) {
            return (
                <view class="flex-fill bg-base-100 p-6">
                    <Text class="opacity-60">Trip not found</Text>
                </view>
            );
        }

        const share = () => {
            Haptics.selection();
            Share.share({ title: trip.name, message: buildSummary(trip) });
        };

        const remove = (entryId: string) => {
            Haptics.notification('warning');
            deleteEntry(tripId, entryId);
        };

        return (
            <view class="flex-fill bg-base-100">
                <Screen title={() => getTrip(tripId)?.name ?? 'Trip'}>
                    <Screen.HeaderRight>
                        <Row gap={4} align="center">
                            <view
                                bindtap={() => nav.push('tripGuide', { tripId })}
                                class="px-3 py-2"
                                accessibility-element={true}
                                accessibility-label="Open Wikivoyage guide for this destination"
                                accessibility-trait="button"
                            >
                                <text class="text-primary text-base">Guide</text>
                            </view>
                            <view
                                bindtap={share}
                                class="px-3 py-2"
                                accessibility-element={true}
                                accessibility-label="Share trip"
                                accessibility-trait="button"
                            >
                                <text class="text-primary text-base">Share</text>
                            </view>
                            <view
                                bindtap={() => nav.push('newEntry', { tripId })}
                                class="px-3 py-2"
                                accessibility-element={true}
                                accessibility-label="Add entry"
                                accessibility-trait="button"
                            >
                                <text class="text-primary text-xl font-semibold">+</text>
                            </view>
                        </Row>
                    </Screen.HeaderRight>
                </Screen>

                <ScrollView class="flex-1">
                    <Col gap={12} padding={16}>
                        {trip.entries.length === 0
                            ? <Text class="opacity-60">No entries yet — tap + to add one</Text>
                            : trip.entries.map((e) => (
                                <Card bordered>
                                    <Card.Body>
                                        <EntryPhotos
                                            entry={e}
                                            onTap={(index) =>
                                                nav.push('imageViewer', {
                                                    tripId,
                                                    entryId: e.id,
                                                    index,
                                                })}
                                        />
                                        {e.videoUri
                                            ? (
                                                <view
                                                    style={{
                                                        width: '100%',
                                                        aspectRatio: 16 / 9,
                                                        borderRadius: 10,
                                                        overflow: 'hidden',
                                                        marginBottom: 8,
                                                    }}
                                                >
                                                    <VideoPlayer
                                                        src={e.videoUri}
                                                        controls
                                                        resizeMode="contain"
                                                        style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
                                                    />
                                                </view>
                                            )
                                            : null}
                                        <Text>{e.note}</Text>
                                        <Row gap={8} align="center" class="mt-2">
                                            {e.coords
                                                ? <Badge variant="ghost" size="sm">
                                                    {e.coords.lat.toFixed(3)}, {e.coords.lng.toFixed(3)}
                                                </Badge>
                                                : null}
                                            {e.voiceNoteUri ? <VoiceNoteButton uri={e.voiceNoteUri} /> : null}
                                            <view style={{ flexGrow: 1 }} />
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onPress={() => nav.push('newEntry', { tripId, entryId: e.id })}
                                            >
                                                Edit
                                            </Button>
                                            <Button size="xs" variant="ghost" onPress={() => remove(e.id)}>
                                                Delete
                                            </Button>
                                        </Row>
                                    </Card.Body>
                                </Card>
                            ))}
                    </Col>
                </ScrollView>
            </view>
        );
    };
});
