import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { FilePicker } from '@sigx/lynx-file-picker';

/**
 * Fetch — the global `fetch` provided by @sigx/lynx-http (default-wired
 * through @sigx/lynx, so note: no http import in this file):
 *
 *  • GET JSON with headers — the everyday path.
 *  • Multipart upload — pick a file, POST it as FormData field `file`
 *    with upload progress; bytes stream natively from the URI.
 *
 * Uses httpbin.org, which echoes back what it received.
 */
export const HttpDemo = component(() => {
    const getResult = signal<{ value: string | null }>({ value: null });
    const uploadResult = signal<{ value: string | null }>({ value: null });
    const progress = signal<{ value: number }>({ value: -1 });

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
                                Global fetch — no import needed; @sigx/lynx wires
                                @sigx/lynx-http into every app.
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
            </Col>
        </ScrollView>
    );
});
