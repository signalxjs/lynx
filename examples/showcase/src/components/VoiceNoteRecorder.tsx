import { component, signal, type Define } from '@sigx/lynx';
import { Audio, type AudioHandle, type RecordingHandle } from '@sigx/lynx-audio';
import { Button, Col, Row, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';

type VoiceNoteRecorderProps =
    & Define.Prop<'uri', string | null, false>
    & Define.Prop<'onRecorded', (uri: string) => void, false>
    & Define.Prop<'onCleared', () => void, false>;

/**
 * One-shot voice-note recorder used by the Media demo.
 *
 * Reactive states: idle (no clip yet) → recording → recorded. The component
 * owns the live recording handle and meter subscription; on stop, it hands
 * back the resulting file URI through `onRecorded`.
 */
export const VoiceNoteRecorder = component<VoiceNoteRecorderProps>(({ props }) => {
    const recording = signal<{ value: RecordingHandle | null }>({ value: null });
    const meter = signal(0);
    const elapsedMs = signal(0);
    const playing = signal<{ value: AudioHandle | null }>({ value: null });
    let elapsedTimer: number | null = null;
    let meterUnsub: (() => void) | null = null;

    const startTimer = () => {
        const start = Date.now();
        elapsedMs.value = 0;
        elapsedTimer = setInterval(() => {
            elapsedMs.value = Date.now() - start;
        }, 100) as unknown as number;
    };
    const stopTimer = () => {
        if (elapsedTimer !== null) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
    };

    const record = async () => {
        if (!Audio.isAvailable()) return;
        try {
            const perm = await Audio.requestPermission();
            if (perm.status !== 'granted') return;
            const handle = await Audio.startRecording({ format: 'm4a' });
            recording.value = handle;
            startTimer();
            meterUnsub = handle.onMeter(({ peak }) => {
                meter.value = peak;
            });
            Haptics.impact('light');
        } catch (e) {
            console.warn('[VoiceNote] start failed:', e);
        }
    };

    const stop = async () => {
        const handle = recording.value;
        if (!handle) return;
        try {
            meterUnsub?.();
            meterUnsub = null;
            stopTimer();
            const { uri } = await handle.stop();
            recording.value = null;
            meter.value = 0;
            Haptics.notification('success');
            props.onRecorded?.(uri);
        } catch (e) {
            console.warn('[VoiceNote] stop failed:', e);
        }
    };

    const togglePlayback = async () => {
        const uri = props.uri;
        if (!uri) return;
        const existing = playing.value;
        if (existing) {
            try { await existing.stop(); } catch {}
            playing.value = null;
            return;
        }
        try {
            const handle = await Audio.play(uri);
            playing.value = handle;
            handle.onEnd(() => {
                playing.value = null;
            });
        } catch (e) {
            console.warn('[VoiceNote] playback failed:', e);
        }
    };

    const clear = () => {
        const p = playing.value;
        if (p) {
            void p.stop();
            playing.value = null;
        }
        props.onCleared?.();
    };

    return () => {
        const isRecording = recording.value !== null;
        const hasClip = !!props.uri;
        const meterPct = Math.min(100, Math.round(meter.value * 100));
        const seconds = (elapsedMs.value / 1000).toFixed(1);

        if (isRecording) {
            return (
                <Col gap={8}>
                    <Row align="center" justify="space-between">
                        <Text weight="semibold">● Recording…</Text>
                        <Text class="text-sm opacity-70">{seconds}s</Text>
                    </Row>
                    {/* Naive meter — a thin red bar whose width tracks peak power. */}
                    <view
                        style={{
                            width: '100%',
                            height: 4,
                            backgroundColor: 'rgba(255,255,255,0.1)',
                            borderRadius: 2,
                        }}
                    >
                        <view
                            style={{
                                width: `${meterPct}%`,
                                height: '100%',
                                backgroundColor: '#ef4444',
                                borderRadius: 2,
                            }}
                        />
                    </view>
                    <Button color="error" onPress={stop}>Stop recording</Button>
                </Col>
            );
        }

        if (hasClip) {
            return (
                <Row align="center" gap={8}>
                    <Button size="sm" color="primary" variant="outline" onPress={togglePlayback}>
                        {playing.value ? 'Stop' : 'Play voice note'}
                    </Button>
                    <Button size="sm" variant="ghost" onPress={clear}>
                        Remove
                    </Button>
                </Row>
            );
        }

        return (
            <Button color="secondary" variant="outline" onPress={record}>
                Record voice note
            </Button>
        );
    };
});
