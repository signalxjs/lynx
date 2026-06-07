import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { FilePicker } from '@sigx/lynx-file-picker';
// On-device the global `fetch`/`FormData` need no import (@sigx/lynx
// default-wires @sigx/lynx-http). The explicit import here is for the
// sigx-specific TYPES — file-handle FormData values and the non-standard
// onUploadProgress — which the ambient DOM lib doesn't know about.
import { fetch, FormData } from '@sigx/lynx-http';

/**
 * Fetch — the HTTP transport provided by @sigx/lynx-http:
 *
 *  • GET JSON with headers — the everyday path.
 *  • Multipart upload — pick a file, POST it as FormData field `file`
 *    with upload progress; bytes stream natively from the URI.
 *  • Streaming body — res.body.getReader() renders lines as the
 *    network delivers them (the SSE/chat-token path).
 *
 * Uses httpbin.org, which echoes back what it received.
 */
export const HttpDemo = component(() => {
    const getResult = signal<{ value: string | null }>({ value: null });
    const uploadResult = signal<{ value: string | null }>({ value: null });
    const progress = signal<{ value: number }>({ value: -1 });
    const streamResult = signal<{ value: string | null }>({ value: null });

    const runStream = async () => {
        streamResult.value = 'streaming…';
        try {
            // httpbin streams 5 JSON objects, one per line, with flushes
            // between them — a stand-in for an SSE/chat-token endpoint.
            const res = await fetch('https://httpbin.org/stream/5');
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let lines = 0;
            let pending = '';
            const drain = () => {
                for (;;) {
                    const nl = pending.indexOf('\n');
                    if (nl < 0) break;
                    if (pending.slice(0, nl).trim().length > 0) lines++;
                    pending = pending.slice(nl + 1);
                    streamResult.value = `received ${lines} line(s)…`;
                }
            };
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                pending += decoder.decode(value, { stream: true });
                drain();
            }
            // Flush the decoder and count a final unterminated line — bytes
            // can end mid-UTF-8-sequence or without a trailing newline.
            pending += decoder.decode();
            drain();
            if (pending.trim().length > 0) lines++;
            streamResult.value = `done — ${lines} lines streamed incrementally ✓`;
        } catch (e) {
            streamResult.value = `failed: ${e instanceof Error ? e.message : String(e)}`;
        }
    };

    const runGet = async () => {
        getResult.value = '…';
        try {
            const res = await fetch('https://httpbin.org/json', {
                headers: { Accept: 'application/json' },
            });
            const data = await res.json() as { slideshow?: { title?: string } };
            getResult.value = `HTTP ${res.status} — slideshow.title: ${data.slideshow?.title ?? '?'}`;
        } catch (e) {
            getResult.value = `failed: ${e instanceof Error ? e.message : String(e)}`;
        }
    };

    const runUpload = async () => {
        const picked = await FilePicker.pick();
        if (picked.cancelled || picked.assets.length === 0) return;
        const file = picked.assets[0];

        uploadResult.value = `uploading ${file.name}…`;
        progress.value = 0;
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('purpose', 'showcase-demo');
            const res = await fetch('https://httpbin.org/post', {
                method: 'POST',
                headers: { Authorization: 'Bearer demo-token' },
                body: form,
                onUploadProgress: (loaded, total) => {
                    progress.value = total > 0 ? Math.round((loaded / total) * 100) : -1;
                },
            });
            const echo = await res.json() as {
                files?: Record<string, string>;
                form?: Record<string, string>;
                headers?: Record<string, string>;
            };
            const gotFile = echo.files && 'file' in echo.files;
            const auth = echo.headers?.['Authorization'] === 'Bearer demo-token';
            uploadResult.value =
                `HTTP ${res.status} — server saw field "file": ${gotFile ? 'yes' : 'no'}, ` +
                `form.purpose: ${echo.form?.purpose ?? '?'}, auth header: ${auth ? 'yes' : 'no'}`;
        } catch (e) {
            uploadResult.value = `failed: ${e instanceof Error ? e.message : String(e)}`;
        } finally {
            progress.value = -1;
        }
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Fetch" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Fetch (lynx-http)</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">GET JSON</Text>
                            <Text class="opacity-60 text-sm">
                                fetch via @sigx/lynx-http — default-wired by
                                @sigx/lynx, so apps get a global fetch too.
                            </Text>
                            <Button color="secondary" variant="outline" onPress={runGet}>
                                GET httpbin.org/json
                            </Button>
                            {getResult.value && <Text class="text-sm">{getResult.value}</Text>}
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Multipart upload</Text>
                            <Text class="opacity-60 text-sm">
                                Pick a file, POST it as FormData field "file" with a
                                bearer header — bytes stream natively from the URI,
                                never through the JS bridge.
                            </Text>
                            <Button color="secondary" variant="outline" onPress={runUpload}>
                                Pick & upload
                            </Button>
                            {progress.value >= 0 && (
                                <Text class="text-sm">{`upload ${progress.value}%`}</Text>
                            )}
                            {uploadResult.value && <Text class="text-sm">{uploadResult.value}</Text>}
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Streaming body</Text>
                            <Text class="opacity-60 text-sm">
                                res.body.getReader() + TextDecoder — lines render
                                as the network delivers them, the same path a
                                chat SSE consumer uses.
                            </Text>
                            <Button color="secondary" variant="outline" onPress={runStream}>
                                Stream 5 lines
                            </Button>
                            {streamResult.value && <Text class="text-sm">{streamResult.value}</Text>}
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
