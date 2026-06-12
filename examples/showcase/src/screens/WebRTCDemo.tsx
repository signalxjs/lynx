import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import {
    MediaStream,
    MediaStreamTrack,
    RTCDataChannel,
    RTCPeerConnection,
    WebRTC,
    isWebRTCAvailable,
    mediaDevices,
    type RTCIceCandidateInit,
} from '@sigx/lynx-webrtc';

/**
 * WebRTC — in-process loopback call via @sigx/lynx-webrtc.
 *
 * Two peer connections in the same JS heap, wired candidate-to-candidate
 * and offer/answer directly — no server. The mic track sent by peer A
 * comes back as a remote track on peer B and plays through the device
 * audio (you hear yourself, slightly delayed), and a data channel
 * ping-pongs messages. Verifies the whole native stack end-to-end with
 * zero infrastructure.
 */
export const WebRTCDemo = component(() => {
    const status = signal<string>('idle');
    const route = signal<string>('speaker');
    const muted = signal(false);
    const log = signal<{ lines: string[] }>({ lines: [] });

    let peerA: RTCPeerConnection | null = null;
    let peerB: RTCPeerConnection | null = null;
    let micTrack: MediaStreamTrack | null = null;
    let micStream: MediaStream | null = null;
    let pingChannel: RTCDataChannel | null = null;
    let pings = 0;

    const append = (line: string) => {
        log.lines = [...log.lines.slice(-19), line];
    };

    const startCall = async () => {
        if (!isWebRTCAvailable()) {
            status.value = 'WebRTC module not available on this platform';
            return;
        }
        if (peerA) return;
        try {
            status.value = 'capturing mic…';
            micStream = await mediaDevices.getUserMedia({ audio: true });
            micTrack = micStream.getAudioTracks()[0]!;
            append(`mic captured (${micTrack.label})`);

            peerA = new RTCPeerConnection();
            peerB = new RTCPeerConnection();
            const a = peerA;
            const b = peerB;

            // Trickle ICE, looped back in-process.
            a.onicecandidate = e => {
                if (e.candidate) void b.addIceCandidate(e.candidate as RTCIceCandidateInit);
            };
            b.onicecandidate = e => {
                if (e.candidate) void a.addIceCandidate(e.candidate as RTCIceCandidateInit);
            };
            a.onconnectionstatechange = () => {
                status.value = `connection: ${a.connectionState}`;
            };
            a.onicegatheringstatechange = () => {
                append(`A gathering: ${a.iceGatheringState}`);
            };

            // B echoes everything A sends.
            b.ondatachannel = e => {
                const dc = e.channel as RTCDataChannel;
                dc.onmessage = msg => dc.send(`echo: ${String(msg.data)}`);
            };
            b.ontrack = e => {
                append(`B got remote ${(e.track as MediaStreamTrack).kind} track — listen!`);
            };

            a.addTrack(micTrack, micStream);
            pingChannel = a.createDataChannel('loopback');
            pingChannel.onopen = () => append('data channel open');
            pingChannel.onmessage = msg => append(String(msg.data));

            status.value = 'negotiating…';
            const offer = await a.createOffer();
            await a.setLocalDescription(offer);
            await b.setRemoteDescription(offer);
            const answer = await b.createAnswer();
            await b.setLocalDescription(answer);
            await a.setRemoteDescription(answer);
            append('offer/answer exchanged');
        } catch (err) {
            const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            hangUp(); // resets status — set the error message after
            status.value = `error: ${message}`;
        }
    };

    const sendPing = () => {
        if (!pingChannel || pingChannel.readyState !== 'open') {
            append('data channel not open yet');
            return;
        }
        pings += 1;
        pingChannel.send(`ping #${pings}`);
    };

    const toggleMute = () => {
        if (!micTrack) return;
        muted.value = !muted.value;
        micTrack.enabled = !muted.value;
    };

    const toggleRoute = async () => {
        const next = route.value === 'speaker' ? 'earpiece' : 'speaker';
        try {
            await WebRTC.setAudioOutput(next);
            route.value = next;
        } catch (err) {
            append(`setAudioOutput: ${String(err)}`);
        }
    };

    const hangUp = () => {
        peerA?.close();
        peerB?.close();
        micTrack?.stop();
        peerA = peerB = null;
        micTrack = null;
        micStream = null;
        pingChannel = null;
        pings = 0;
        muted.value = false;
        status.value = 'idle';
        append('hung up');
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="WebRTC" />
            <Col gap={16} padding={16}>
                <Heading level={2}>WebRTC loopback</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Echo call (no server)</Text>
                            <Text class="opacity-60 text-sm">
                                Two in-process RTCPeerConnections wired directly:
                                your mic loops back through libwebrtc and plays —
                                expect to hear yourself. The data channel echoes
                                pings.
                            </Text>
                            <Row gap={8} wrap>
                                <Button color="primary" onPress={startCall}>
                                    Start call
                                </Button>
                                <Button onPress={sendPing}>Send ping</Button>
                                <Button onPress={toggleMute}>
                                    {muted.value ? 'Unmute' : 'Mute'}
                                </Button>
                                <Button onPress={toggleRoute}>
                                    Route: {route.value}
                                </Button>
                                <Button color="error" onPress={hangUp}>
                                    Hang up
                                </Button>
                            </Row>
                            <Text class="font-mono text-sm opacity-70">
                                status: {status.value}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={4}>
                            <Text weight="semibold">Event log</Text>
                            {log.lines.length === 0 ? (
                                <Text class="opacity-50 text-sm">—</Text>
                            ) : (
                                log.lines.map((line, i) => (
                                    <Text key={`${i}-${line}`} class="font-mono text-xs opacity-70">
                                        {line}
                                    </Text>
                                ))
                            )}
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
