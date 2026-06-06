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
 * The showcase doesn't ship a video-capture path (the camera package is
 * still photo-only), so the "Attach video" button populates a remote sample
 * clip. This keeps the wiring honest end-to-end: the same URI a real capture
 * pipeline would emit gets rendered through `<VideoPlayer>`.
 */
const SAMPLE_VIDEO_URL =
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

export const VideoClipPlayer = component<VideoClipPlayerProps>(({ props }) => {
    const playing = signal(false);

    return () => {
        const uri = props.uri;
        if (!uri) {
            return (
                <Button
                    variant="secondary"
                    outline
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
                        variant="primary"
                        outline
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
