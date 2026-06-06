import { component, onMounted, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button,
    Card,
    Col,
    Heading,
    Input,
    Modal,
    Row,
    ScrollView,
    Text,
} from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { Storage } from '@sigx/lynx-storage';

const DEMO_KEY = 'showcase.storage-demo';

/**
 * Storage — key/value persistence via @sigx/lynx-storage. Write a value,
 * relaunch the app, and it's still there. The destructive "clear all"
 * path runs behind a Modal confirm.
 */
export const StorageDemo = component(() => {
    const draft = signal('');
    const stored = signal<string | null>(null);
    const keys = signal<string[]>([]);
    const confirmOpen = signal(false);

    const refresh = async () => {
        // Guard availability and swallow native failures — an unhandled
        // rejection out of onMounted would take the whole screen down.
        if (!Storage.isAvailable()) return;
        try {
            stored.value = await Storage.getItem(DEMO_KEY);
            keys.$set(await Storage.getAllKeys());
        } catch {
            // leave the last known values in place
        }
    };

    onMounted(refresh);

    // The mutations are callSync() bridge calls — they throw (rather than
    // reject) when the native module isn't registered, so each handler
    // guards availability and swallows failures like refresh() does.
    const onSave = async () => {
        Haptics.selection();
        if (!Storage.isAvailable()) return;
        try { Storage.setItem(DEMO_KEY, draft.value); } catch { /* keep UI alive */ }
        await refresh();
    };
    const onRemove = async () => {
        Haptics.selection();
        if (!Storage.isAvailable()) return;
        try { Storage.removeItem(DEMO_KEY); } catch { /* keep UI alive */ }
        await refresh();
    };
    const onClearAll = async () => {
        Haptics.notification('warning');
        confirmOpen.value = false;
        if (!Storage.isAvailable()) return;
        try { Storage.clear(); } catch { /* keep UI alive */ }
        await refresh();
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Storage" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Storage</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Key/value round-trip</Text>
                            <Text class="opacity-60 text-sm">
                                setItem / getItem / removeItem against the
                                `{DEMO_KEY}` key. Saved values survive an app
                                relaunch.
                            </Text>
                            <Input
                                placeholder="Value to store"
                                variant="bordered"
                                model={() => draft.value}
                            />
                            <Row gap={8}>
                                <Button variant="primary" onPress={onSave}>
                                    Save
                                </Button>
                                <Button variant="ghost" onPress={onRemove}>
                                    Remove
                                </Button>
                            </Row>
                            <Text class="font-mono text-sm opacity-70">
                                stored: {stored.value ?? '—'}{'\n'}
                                keys: {keys.length ? keys.join(', ') : '—'}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Clear all data</Text>
                            <Text class="opacity-60 text-sm">
                                Storage.clear() wipes every key in the store —
                                gated behind a Modal confirm.
                            </Text>
                            <Button
                                variant="error"
                                outline
                                onPress={() => { confirmOpen.value = true; }}
                            >
                                Clear all data
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>

            <Modal open={confirmOpen.value} onClose={() => { confirmOpen.value = false; }}>
                <Modal.Header>
                    <Heading level={3}>Clear all data?</Heading>
                </Modal.Header>
                <Modal.Body>
                    <Text>
                        This will permanently remove every key in storage.
                        This action cannot be undone.
                    </Text>
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="ghost" onPress={() => { confirmOpen.value = false; }}>
                        Cancel
                    </Button>
                    <Button variant="error" onPress={onClearAll}>
                        Clear
                    </Button>
                </Modal.Actions>
            </Modal>
        </ScrollView>
    );
});
