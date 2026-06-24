import { component, signal } from '@sigx/lynx';
import { Button, Col, Modal, Row, Text } from '@sigx/lynx-daisyui';
import { Camera } from '@sigx/lynx-camera';
import { ImagePicker } from '@sigx/lynx-image-picker';
import { VideoPlayer } from '@sigx/lynx-video';

type Asset = { uri: string; type: 'image' | 'video' };

/**
 * WhatsApp-style capture/pick entry point. One button opens a chooser that
 * fans out to the four media building blocks:
 *
 *  • Take Photo   → @sigx/lynx-camera     Camera.takePicture()
 *  • Record Video → @sigx/lynx-camera     Camera.recordVideo()
 *  • Pick Photo   → @sigx/lynx-image-picker ImagePicker.pickImage()
 *  • Pick Video   → @sigx/lynx-image-picker ImagePicker.pickVideo()
 *
 * The cross-platform "photo or video" choice lives here in the app (an action
 * sheet built from daisyui's Modal), not in the camera package — Android has no
 * single system intent that toggles photo/video in-camera the way iOS does.
 */
export const MediaCaptureCard = component(() => {
    // Object-wrapped so the signal proxy gives a stable `.value` slot for the
    // mutable array reference (same pattern as MediaDemo's photoUris).
    const assets = signal<{ value: Asset[] }>({ value: [] });
    const menuOpen = signal(false);
    const error = signal<{ value: string | null }>({ value: null });

    const add = (a: Asset) => { assets.value = [...assets.value, a]; };
    const remove = (uri: string) => { assets.value = assets.value.filter((x) => x.uri !== uri); };
    const close = () => { menuOpen.value = false; };

    // Native errors (permission denied, no camera on the iOS Simulator) come
    // back as `{ error }` rather than a rejected Promise; surface either path.
    const run = async (fn: () => Promise<void>) => {
        close();
        error.value = null;
        try {
            await fn();
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e);
        }
    };

    const surfaceNativeError = (r: unknown) => {
        const result = r as { error?: unknown } | null | undefined;
        // Surface only real failures. User cancel carries no error on iOS and
        // the `"cancelled"` sentinel on Android — but Android also sets
        // `cancelled: true` on genuine failures (FileProvider misconfig, not
        // registered, activity destroyed), so we key off the error string, not
        // the cancelled flag, to keep those visible.
        if (result?.error && result.error !== 'cancelled') error.value = String(result.error);
    };

    const takePhoto = () => run(async () => {
        const r = await Camera.takePicture({ quality: 0.8 });
        if (r?.uri) add({ uri: r.uri, type: 'image' });
        else surfaceNativeError(r);
    });

    const recordVideo = () => run(async () => {
        const r = await Camera.recordVideo({ maxDurationMs: 60_000 });
        if (r?.uri) add({ uri: r.uri, type: 'video' });
        else surfaceNativeError(r);
    });

    const pickPhoto = () => run(async () => {
        const r = await ImagePicker.pickImage();
        if (!r.cancelled) r.assets.forEach((a) => add({ uri: a.uri, type: 'image' }));
    });

    const pickVideo = () => run(async () => {
        const r = await ImagePicker.pickVideo();
        if (!r.cancelled) r.assets.forEach((a) => add({ uri: a.uri, type: a.type === 'video' ? 'video' : 'image' }));
    });

    const renderAsset = (a: Asset) => {
        if (a.type === 'video') {
            return (
                <Col key={a.uri} gap={4}>
                    <view style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden' }}>
                        <VideoPlayer
                            src={a.uri}
                            controls
                            resizeMode="contain"
                            style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
                        />
                    </view>
                    <Row align="center" gap={8}>
                        <Text class="text-xs opacity-60">🎬 {a.uri.split('/').pop()}</Text>
                        <Button size="sm" variant="ghost" onPress={() => remove(a.uri)}>Remove</Button>
                    </Row>
                </Col>
            );
        }
        return (
            <Row key={a.uri} align="center" gap={8}>
                <image
                    src={a.uri}
                    mode="aspectFill"
                    style={{ width: 64, height: 64, borderRadius: 8 }}
                />
                <Text class="text-xs opacity-60 flex-fill">🖼️ {a.uri.split('/').pop()}</Text>
                <Button size="sm" variant="ghost" onPress={() => remove(a.uri)}>Remove</Button>
            </Row>
        );
    };

    return () => (
        <Col gap={12}>
            {assets.value.length > 0 && (
                <Col gap={12}>{assets.value.map(renderAsset)}</Col>
            )}

            {error.value && (
                <Text class="text-error text-sm">{error.value}</Text>
            )}

            <Button color="primary" onPress={() => { menuOpen.value = true; }}>
                {assets.value.length > 0 ? 'Add more' : 'Capture or pick media'}
            </Button>

            <Modal open={menuOpen.value} onClose={close}>
                <Modal.Header><Text weight="semibold">Add media</Text></Modal.Header>
                <Modal.Body>
                    <Col gap={8}>
                        <Button variant="outline" onPress={takePhoto}>📷 Take Photo</Button>
                        <Button variant="outline" onPress={recordVideo}>🎥 Record Video</Button>
                        <Button variant="outline" onPress={pickPhoto}>🖼️ Pick Photo</Button>
                        <Button variant="outline" onPress={pickVideo}>🎬 Pick Video</Button>
                    </Col>
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="ghost" onPress={close}>Cancel</Button>
                </Modal.Actions>
            </Modal>
        </Col>
    );
});
