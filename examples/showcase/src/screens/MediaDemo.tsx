import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { ImagePicker } from '@sigx/lynx-image-picker';
import { MediaCaptureCard } from '../components/MediaCaptureCard.js';
import { VoiceNoteRecorder } from '../components/VoiceNoteRecorder.js';
import { VideoClipPlayer } from '../components/VideoClipPlayer.js';

/**
 * Media — capture/pick/playback capabilities on one screen:
 *
 *  • Capture or pick — a WhatsApp-style chooser (MediaCaptureCard) fanning out
 *    to Camera.takePicture / Camera.recordVideo / ImagePicker.pickImage /
 *    ImagePicker.pickVideo.
 *  • @sigx/lynx-image-picker — system photo picker (PHPicker /
 *    PickVisualMedia), multi-select, no permission prompt needed.
 *  • @sigx/lynx-audio — record + meter + playback via VoiceNoteRecorder.
 *  • @sigx/lynx-video — playback via VideoClipPlayer (attaches a remote
 *    sample clip).
 */
export const MediaDemo = component(() => {
    // Wrapped in an object so the signal proxy gives a stable `.value` slot
    // for the mutable array reference; replacing the array re-renders all
    // subscribers.
    const photoUris = signal<{ value: string[] }>({ value: [] });
    const voiceNoteUri = signal<{ value: string | null }>({ value: null });
    const videoUri = signal<{ value: string | null }>({ value: null });

    const pickPhoto = async () => {
        // No `requestPermission` step: the system photo picker grants
        // per-pick access on the fly — asking for `READ_MEDIA_IMAGES` first
        // would show a second, redundant bottom sheet on Android 14+.
        const result = await ImagePicker.pickImage({
            multiple: true,
            maxItems: 10,
            quality: 0.8,
        });
        if (!result.cancelled && result.assets.length > 0) {
            photoUris.value = [...photoUris.value, ...result.assets.map((a) => a.uri)];
        }
    };

    const removePhoto = (uri: string) => {
        photoUris.value = photoUris.value.filter((u) => u !== uri);
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Media" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Media</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Capture or pick</Text>
                            <Text class="opacity-60 text-sm">
                                One button, four sources — Take Photo, Record
                                Video, Pick Photo, Pick Video. Camera capture
                                needs a real device (the iOS Simulator has no
                                camera); the library pickers work everywhere.
                            </Text>
                            <MediaCaptureCard />
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Image picker</Text>
                            <Text class="opacity-60 text-sm">
                                System photo picker via @sigx/lynx-image-picker —
                                multi-select, per-pick access, no upfront
                                permission dialog.
                            </Text>
                            {photoUris.value.length > 0 && (
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
                            )}
                            <Button color="secondary" variant="outline" onPress={pickPhoto}>
                                {photoUris.value.length > 0 ? 'Add more photos' : 'Pick photos'}
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Voice note (audio)</Text>
                            <Text class="opacity-60 text-sm">
                                Record with a live level meter, then play back —
                                @sigx/lynx-audio end to end.
                            </Text>
                            <VoiceNoteRecorder
                                uri={voiceNoteUri.value}
                                onRecorded={(uri) => { voiceNoteUri.value = uri; }}
                                onCleared={() => { voiceNoteUri.value = null; }}
                            />
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Video clip</Text>
                            <Text class="opacity-60 text-sm">
                                Attaches a remote sample clip and renders it
                                through @sigx/lynx-video's VideoPlayer.
                            </Text>
                            <VideoClipPlayer
                                uri={videoUri.value}
                                onAttach={(uri) => { videoUri.value = uri; }}
                                onCleared={() => { videoUri.value = null; }}
                            />
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
