import { component, signal } from '@sigx/lynx';
import { useNav, useParams, Screen } from '@sigx/lynx-navigation';
import { Button, Col, NavHeader, Textarea } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { ImagePicker } from '@sigx/lynx-image-picker';
import { Location } from '@sigx/lynx-location';
import { addEntry, getEntry, updateEntry } from '../store/trips.js';
import type { Coords } from '../store/types.js';

/**
 * Create-or-edit entry modal. Reused via the `entryId` param: present →
 * edit existing entry (form pre-populated, save calls `updateEntry`);
 * absent → create new entry (save calls `addEntry`).
 */
export const NewEntry = component(() => {
    const nav = useNav();
    const { tripId, entryId } = useParams('newEntry');
    const existing = entryId ? getEntry(tripId, entryId) : undefined;
    const isEdit = !!existing;

    const note = signal(existing?.note ?? '');
    // Wrap in an object so the signal proxy gives us a stable `.value` slot
    // for the mutable array reference; replacing the array (after pick /
    // remove) re-renders all subscribers without needing fine-grained
    // index-level reactivity on the items themselves.
    const photoUris = signal<{ value: string[] }>({ value: [...(existing?.photoUris ?? [])] });
    // Preserve existing coords on edit; capture fresh on create. Edits
    // don't re-prompt for location — that'd surprise the user.
    // Boxed in an object so the union `Coords | null` satisfies signal's
    // `T extends object` overload (neither `Coords` alone nor `null` fits
    // both halves of the union otherwise). `coords.value` keeps the same
    // read/write ergonomics as a primitive signal.
    const coords = signal<{ value: Coords | null }>({ value: existing?.coords ?? null });

    const pickPhoto = async () => {
        // No `requestPermission` step: the system photo picker
        // (Android `PickVisualMedia`, iOS `PHPicker`) grants per-pick
        // access on the fly — asking for `READ_MEDIA_IMAGES` first
        // would show a second, redundant bottom sheet on Android 14+.
        const result = await ImagePicker.pickImage({
            multiple: true,
            maxItems: 10,
            quality: 0.8,
        });
        if (!result.cancelled && result.assets.length > 0) {
            // Append to the existing list — picker is "add more photos".
            photoUris.value = [...photoUris.value, ...result.assets.map((a) => a.uri)];
        }
    };

    const removePhoto = (uri: string) => {
        photoUris.value = photoUris.value.filter((u) => u !== uri);
    };

    // Best-effort one-shot GPS fix. We do NOT block save on permission or
    // success — entries save without coords if the user denies or the fix
    // times out. The store accepts `coords` optionally.
    const captureCoords = async (): Promise<Coords | undefined> => {
        try {
            const perm = await Location.requestPermission();
            if (perm.status !== 'granted') return undefined;
            const fix = await Location.getCurrentPosition({
                accuracy: 'balanced',
                timeout: 5000,
            });
            return { lat: fix.latitude, lng: fix.longitude };
        } catch {
            return undefined;
        }
    };

    const save = async () => {
        const trimmed = note.value.trim();
        const photos = photoUris.value;
        if (!trimmed && photos.length === 0) return;
        if (isEdit && entryId) {
            updateEntry(tripId, entryId, {
                note: trimmed,
                photoUris: photos,
                coords: coords.value,
            });
        } else {
            const fresh = await captureCoords();
            addEntry(tripId, trimmed, {
                photoUris: photos,
                coords: fresh,
            });
        }
        Haptics.notification('success');
        nav.pop();
    };

    return () => (
        <view class="flex-fill bg-base-100">
            <Screen title={isEdit ? 'Edit entry' : 'New entry'} />
            {/* NavHeader inside the modal so it slides up with the sheet
                (rather than persisting at the top of the viewport above
                the underneath screen's own header during the animation). */}
            <NavHeader />
            <Col gap={16} padding={24}>
                <Textarea placeholder="What happened?" rows={4} model={() => note.value} />
                {photoUris.value.length > 0
                    ? (
                        <Col gap={8}>
                            <scroll-view
                                scroll-orientation="horizontal"
                                style={{ width: '100%', height: 100 }}
                            >
                                <view style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
                                    {photoUris.value.map((uri) => (
                                        <view
                                            key={uri}
                                            style={{ position: 'relative', width: 100, height: 100 }}
                                        >
                                            <image
                                                src={uri}
                                                mode="aspectFill"
                                                style={{ width: '100%', height: '100%', borderRadius: 8 }}
                                            />
                                            <view
                                                bindtap={() => removePhoto(uri)}
                                                style={{
                                                    position: 'absolute',
                                                    top: 4,
                                                    right: 4,
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: 12,
                                                    backgroundColor: 'rgba(0,0,0,0.6)',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <text style={{ color: '#fff', fontSize: 14, lineHeight: 24 }}>×</text>
                                            </view>
                                        </view>
                                    ))}
                                </view>
                            </scroll-view>
                            <Button size="sm" variant="ghost" onPress={pickPhoto}>
                                Add more photos
                            </Button>
                        </Col>
                    )
                    : (
                        <Button variant="secondary" outline onPress={pickPhoto}>
                            Attach photos
                        </Button>
                    )}
                <Button variant="primary" onPress={save}>Save</Button>
                <Button variant="ghost" onPress={() => nav.pop()}>Cancel</Button>
            </Col>
        </view>
    );
});
