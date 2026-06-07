import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { FilePicker, type FilePickerAsset } from '@sigx/lynx-file-picker';
import { FileSystem } from '@sigx/lynx-file-system';

/** Human-readable byte count for the asset list. */
function formatSize(bytes: number): string {
    if (bytes <= 0) return 'unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files — the generic file picker + binary read round-trip:
 *
 *  • @sigx/lynx-file-picker — system document picker (UIDocumentPicker /
 *    SAF OpenDocument), any file type, multi-select, MIME filters, no
 *    permission prompt needed.
 *  • @sigx/lynx-file-system — readFileAsArrayBuffer proves the picked
 *    URI's bytes are readable from JS.
 */
export const FilePickerDemo = component(() => {
    // Wrapped in an object so the signal proxy gives a stable `.value` slot
    // for the mutable array reference (same idiom as MediaDemo).
    const files = signal<{ value: FilePickerAsset[] }>({ value: [] });
    const readResult = signal<{ value: string | null }>({ value: null });

    const pick = async (types?: string[]) => {
        const result = await FilePicker.pick({ multiple: true, types });
        if (!result.cancelled && result.assets.length > 0) {
            files.value = [...files.value, ...result.assets];
        }
    };

    const readBytes = async (asset: FilePickerAsset) => {
        try {
            const buf = await FileSystem.readFileAsArrayBuffer(asset.uri);
            readResult.value = `${asset.name}: read ${buf.byteLength} bytes ✓` +
                (asset.size > 0 && buf.byteLength !== asset.size
                    ? ` (picker reported ${asset.size})`
                    : '');
        } catch (e) {
            readResult.value = `${asset.name}: read failed — ${e instanceof Error ? e.message : String(e)}`;
        }
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Files" />
            <Col gap={16} padding={16}>
                <Heading level={2}>File picker</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Pick any file</Text>
                            <Text class="opacity-60 text-sm">
                                System document picker via @sigx/lynx-file-picker —
                                any file type, multi-select, per-pick access, no
                                permission dialog. (Photo-library grid lives in the
                                Media demo / @sigx/lynx-image-picker.)
                            </Text>
                            <Button color="secondary" variant="outline" onPress={() => pick()}>
                                Pick files
                            </Button>
                            <Button color="secondary" variant="outline" onPress={() => pick(['application/pdf'])}>
                                Pick PDFs only
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>

                {files.value.length > 0 && (
                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Text weight="semibold">Picked files</Text>
                                {files.value.map((f) => (
                                    <view
                                        key={f.uri}
                                        bindtap={() => readBytes(f)}
                                        style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4, paddingBottom: 4 }}
                                    >
                                        <Text>{f.name}</Text>
                                        <Text class="opacity-60 text-sm">
                                            {`${f.mimeType} · ${formatSize(f.size)} — tap to read bytes`}
                                        </Text>
                                    </view>
                                ))}
                                {readResult.value && (
                                    <Text class="text-sm">{readResult.value}</Text>
                                )}
                            </Col>
                        </Card.Body>
                    </Card>
                )}
            </Col>
        </ScrollView>
    );
});
