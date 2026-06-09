import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Progress, ScrollView, Text, markdownComponents } from '@sigx/lynx-daisyui';
import { FilePicker } from '@sigx/lynx-file-picker';
import { MarkdownView, createMarkdownStream } from '@sigx/lynx-markdown';
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
 *  • Streaming body — res.body.getReader() reads a real Server-Sent-Events
 *    feed (Wikimedia recentchange) and renders each live event into a
 *    streaming `<MarkdownView>` as it arrives (the SSE/chat path).
 *
 * GET/upload use httpbin.org, which echoes back what it received.
 */
export const HttpDemo = component(() => {
    const getResult = signal<{ value: string | null }>({ value: null });
    const uploadResult = signal<{ value: string | null }>({ value: null });
    const progress = signal<{ value: number }>({ value: -1 });
    const streamResult = signal<{ value: string | null }>({ value: null });
    // Streaming markdown sink — `append()` per token, `<MarkdownView>` renders
    // its reactive `value` progressively (finalized blocks don't reflow).
    const md = createMarkdownStream({ flushIntervalMs: 16 });
    const statusResult = signal<{
        value: { lineA: string; lineB: string; note: string; verdict: string; pass: boolean } | null;
    }>({ value: null });

    // #342 device regression check. The bug: on Lynx 0.5.0 the response
    // event's status/statusText/headers were dropped crossing the native
    // bridge, so res.status came back undefined and res.ok was false for
    // every request — even a 200 whose body read fine. The invariant that
    // proves the fix is "status is a populated number AND res.ok ===
    // (status in 200..299)", independent of the exact code — so a flaky
    // endpoint (e.g. a 503) still validates that the status round-trips the
    // bridge. We hit a should-be-2xx and a should-be-404 endpoint and, as a
    // bonus, note whether res.ok actually flipped between them.
    const probe = async (url: string) => {
        const res = await fetch(url);
        await res.text(); // drain so the native request completes cleanly
        const populated = typeof res.status === 'number' && res.status >= 100;
        const consistent = res.ok === (res.status >= 200 && res.status < 300);
        return {
            line: `${url.replace('https://', '')} → status=${String(res.status)} ok=${String(res.ok)} statusText="${res.statusText}"`,
            populated,
            consistent,
            ok: res.ok,
        };
    };

    const runStatusCheck = async () => {
        statusResult.value = { lineA: 'checking…', lineB: '', note: '', verdict: '', pass: false };
        try {
            const a = await probe('https://jsonplaceholder.typicode.com/todos/1');
            const b = await probe('https://jsonplaceholder.typicode.com/this-path-does-not-exist');
            // Core #342 invariant: both responses carry a real status code and
            // a consistent ok. Pre-fix, status was undefined → this fails.
            const pass = a.populated && a.consistent && b.populated && b.consistent;
            const flip = a.ok !== b.ok; // bonus: ok actually changed with the code
            statusResult.value = {
                lineA: a.line,
                lineB: b.line,
                note: flip
                    ? 'res.ok flipped across the two status codes ✓'
                    : 'note: no 2xx/non-2xx flip this run (endpoint flaky) — invariant still holds',
                verdict: pass
                    ? 'PASS ✓ — status populated & res.ok consistent; survives the native bridge (#342)'
                    : 'FAIL ✗ — status undefined or res.ok inconsistent (bridge regression of #342)',
                pass,
            };
        } catch (e) {
            statusResult.value = {
                lineA: `request failed: ${e instanceof Error ? e.message : String(e)}`,
                lineB: '',
                note: '',
                verdict: 'FAIL ✗ — request threw before status could be checked',
                pass: false,
            };
        }
    };

    // Neutralize markdown control chars in live text so a page title can't
    // break the rendered list (wrap the value in an inline-code span).
    const code = (s: string) => `\`${String(s).replace(/`/g, "'")}\``;

    const STREAM_LIMIT = 14;
    const runStream = async () => {
        md.reset();
        md.append('## Live edits — Wikimedia SSE\n\n');
        streamResult.value = 'connecting…';
        try {
            // A REAL server-sent-events feed: every byte rendered comes off the
            // wire. res.body.getReader() yields events the instant they arrive
            // (no artificial pacing) and each one is appended to the streaming
            // <MarkdownView> — the genuine chat/SSE path, as snappy as the feed.
            const res = await fetch('https://stream.wikimedia.org/v2/stream/recentchange');
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            let data = '';
            let count = 0;
            outer: for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let nl: number;
                while ((nl = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, nl).replace(/\r$/, '');
                    buf = buf.slice(nl + 1);
                    if (line.startsWith('data:')) {
                        data += line.slice(5).trim();
                    } else if (line === '') {
                        // Blank line = SSE event boundary; render the event now.
                        if (data) {
                            try {
                                const ev = JSON.parse(data) as {
                                    type?: string; title?: string; user?: string; server_name?: string;
                                };
                                if (ev.type && ev.title) {
                                    md.append(`- **${ev.type}** ${code(ev.server_name ?? '')} — ${code(ev.title)} by ${code(ev.user ?? '?')}\n`);
                                    streamResult.value = `${++count}/${STREAM_LIMIT} live events…`;
                                    if (count >= STREAM_LIMIT) { await reader.cancel(); break outer; }
                                }
                            } catch { /* skip keep-alive / non-JSON frames */ }
                        }
                        data = '';
                    }
                }
            }
            md.done();
            streamResult.value = `done — ${count} live events streamed off the wire ✓`;
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
                            <Text weight="semibold">Response status (#342)</Text>
                            <Text class="opacity-60 text-sm">
                                Verifies res.status is a populated number and
                                res.ok is consistent with it across two
                                endpoints — the invariant that regressed on
                                Lynx 0.5.0 (status arrived undefined).
                            </Text>
                            <Button color="primary" variant="outline" onPress={runStatusCheck}>
                                Check status round-trip
                            </Button>
                            {statusResult.value && (
                                <Col gap={4}>
                                    <Text class="text-sm font-mono">{statusResult.value.lineA}</Text>
                                    {statusResult.value.lineB !== '' && (
                                        <Text class="text-sm font-mono">{statusResult.value.lineB}</Text>
                                    )}
                                    {statusResult.value.note !== '' && (
                                        <Text class="text-sm opacity-60">{statusResult.value.note}</Text>
                                    )}
                                    {statusResult.value.verdict !== '' && (
                                        <Text
                                            weight="semibold"
                                            class={statusResult.value.pass ? 'text-success' : 'text-error'}
                                        >
                                            {statusResult.value.verdict}
                                        </Text>
                                    )}
                                </Col>
                            )}
                        </Col>
                    </Card.Body>
                </Card>

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
                                <Col gap={4}>
                                    <Progress value={progress.value} max={100} color="secondary" />
                                    <Text class="text-sm opacity-60">{`uploading… ${progress.value}%`}</Text>
                                </Col>
                            )}
                            {uploadResult.value && <Text class="text-sm">{uploadResult.value}</Text>}
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Streaming body → markdown</Text>
                            <Text class="opacity-60 text-sm">
                                A real Server-Sent-Events feed: res.body.getReader()
                                yields live Wikimedia edits the instant they hit
                                the wire and renders each into a streaming
                                MarkdownView — the genuine chat/SSE path.
                            </Text>
                            <Button color="secondary" variant="outline" onPress={runStream}>
                                Stream live events
                            </Button>
                            {md.value.value.length > 0 && (
                                <view class="bg-base-200 rounded-box p-3">
                                    <MarkdownView value={md.value.value} components={markdownComponents} />
                                </view>
                            )}
                            {streamResult.value && <Text class="text-sm opacity-60">{streamResult.value}</Text>}
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
