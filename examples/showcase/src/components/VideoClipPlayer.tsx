import { component, signal, type Define } from '@sigx/lynx';
import { VideoPlayer } from '@sigx/lynx-video';
import { Button, Col, Row, Text } from '@sigx/lynx-daisyui';

type VideoClipPlayerProps =
    & Define.Prop<'uri', string | null, false>
    & Define.Prop<'onAttach', (uri: string) => void, false>
    & Define.Prop<'onCleared', () => void, false>;

/**
 * Video clip preview using `@sigx/lynx-video`.
 *
 * This card focuses on playback, so the "Attach video" button populates a
 * remote sample clip rather than capturing one (camera capture lives in
 * MediaCaptureCard). The same URI a real capture pipeline emits gets rendered
 * through `<VideoPlayer>`.
 */
// Official Blender-hosted Big Buck Bunny clip. The previous
// `commondatastorage.googleapis.com/gtv-videos-bucket` sample bucket now
// returns 403, so the player surface stayed black; this host serves
// `video/mp4` with HTTP range support (which AVPlayer / ExoPlayer need).
const SAMPLE_VIDEO_URL =
    'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4';

export const VideoClipPlayer = component<VideoClipPlayerProps>(({ props }) => {
    const playing = signal(false);

    return () => {
        const uri = props.uri;
        if (!uri) {
            return (
                <Button
                    color="secondary"
                    variant="outline"
                    onPress={() => props.onAttach?.(SAMPLE_VIDEO_URL)}
                >
                    Attach sample video
                </Button>
            );
        }

        return (
            <Col gap={8}>
                <view style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden' }}>
                    <VideoPlayer
                        src={uri}
                        playing={playing.value}
                        controls
                        resizeMode="contain"
                        onEnd={() => { playing.value = false; }}
                        onError={(e) => {
                            console.warn('[VideoClip] error:', e.detail.message);
                            playing.value = false;
                        }}
                        style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
                    />
                </view>
                <Row align="center" gap={8}>
                    <Button
                        size="sm"
                        color="primary"
                        variant="outline"
                        onPress={() => { playing.value = !playing.value; }}
                    >
                        {playing.value ? 'Pause' : 'Play'}
                    </Button>
                    <Button size="sm" variant="ghost" onPress={() => props.onCleared?.()}>
                        Remove
                    </Button>
                    <Text class="text-sm opacity-60">{uri.split('/').pop()}</Text>
                </Row>
            </Col>
        );
    };
});
