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
    const photoUri = signal<string | null>(existing?.photoUri ?? null);
    // Preserve existing coords on edit; capture fresh on create. Edits
    // don't re-prompt for location — that'd surprise the user.
    const coords = signal<Coords | null>(existing?.coords ?? null);

    const pickPhoto = async () => {
        const perm = await ImagePicker.requestPermission();
        if (perm.status !== 'granted') return;
        const result = await ImagePicker.pickImage({ quality: 0.8 });
        if (!result.cancelled && result.assets[0]) {
            photoUri.value = result.assets[0].uri;
        }
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
        if (!trimmed) return;
        if (isEdit && entryId) {
            updateEntry(tripId, entryId, {
                note: trimmed,
                photoUri: photoUri.value,
                coords: coords.value,
            });
        } else {
            const fresh = await captureCoords();
            addEntry(tripId, trimmed, {
                photoUri: photoUri.value ?? undefined,
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
                {photoUri.value
                    ? (
                        <Col gap={8}>
                            <image
                                src={photoUri.value.startsWith('/') ? `file://${photoUri.value}` : photoUri.value}
                                mode="aspectFill"
                                style={{ width: '100%', height: 200, borderRadius: 12 }}
                            />
                            <Button size="sm" variant="ghost" onPress={() => { photoUri.value = null; }}>
                                Remove photo
                            </Button>
                        </Col>
                    )
                    : (
                        <Button variant="secondary" outline onPress={pickPhoto}>
                            Attach photo
                        </Button>
                    )}
                <Button variant="primary" onPress={save}>Save</Button>
                <Button variant="ghost" onPress={() => nav.pop()}>Cancel</Button>
            </Col>
        </view>
    );
});
