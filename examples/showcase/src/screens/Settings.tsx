import { component, signal, useElementLayout } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button,
    Card,
    Col,
    Heading,
    Modal,
    Row,
    ScrollView,
    Text,
    Toggle,
    useTheme,
} from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { Icon } from '@sigx/lynx-icons';
import { FaBrandIcon, FaSolidIcon } from '@sigx/lynx-icons-fa-free/components';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
import { clearAllTrips, trips } from '../store/trips.js';

export const Settings = component(() => {
    const theme = useTheme();
    const confirmOpen = signal(false);
    const { layout: cardLayout, onLayoutChange } = useElementLayout();

    const onClear = () => {
        Haptics.notification('warning');
        clearAllTrips();
        confirmOpen.value = false;
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen headerShown={false} />
            <Col gap={16} padding={16}>
                <Heading level={2}>Settings</Heading>

                <Card bordered>
                    <Card.Body>
                        <Row align="center" justify="space-between">
                            <Col gap={2}>
                                <Text weight="semibold">Dark theme</Text>
                                <Text class="opacity-60 text-sm">
                                    Switch between daisy-light and daisy-dark.
                                </Text>
                            </Col>
                            <Toggle
                                checked={theme.name === 'daisy-dark'}
                                onChange={() => {
                                    Haptics.selection();
                                    theme.toggle();
                                }}
                            />
                        </Row>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Lynx 3.7 — selectable text</Text>
                            <Text class="opacity-60 text-sm">
                                Long-press the paragraph below to select text and
                                copy via the system menu. Powered by daisyui's new
                                `selectable` prop on `Text`, which maps to Lynx's
                                `text-selection` attribute.
                            </Text>
                            <Text selectable>
                                Long-press anywhere in this sentence. The system
                                selection handles should appear and the platform
                                Copy / Share menu should open on iOS and Android.
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Lynx 3.7 — useElementLayout</Text>
                            <Text class="opacity-60 text-sm">
                                The view below reports its own measured size and
                                page position via the new `bindlayoutchange`
                                event, surfaced as a signal by `useElementLayout`.
                            </Text>
                            <view
                                class="bg-base-200 rounded-lg p-4"
                                bindlayoutchange={onLayoutChange}
                            >
                                <Text class="font-mono text-sm">
                                    width: {cardLayout.value?.width ?? '—'}{'\n'}
                                    height: {cardLayout.value?.height ?? '—'}{'\n'}
                                    top: {cardLayout.value?.top ?? '—'}{'\n'}
                                    left: {cardLayout.value?.left ?? '—'}
                                </Text>
                            </view>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Clear all data</Text>
                            <Text class="opacity-60 text-sm">
                                Wipes every trip and entry from persistent
                                storage. {trips.length} trip{trips.length === 1 ? '' : 's'} currently saved.
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

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">@sigx/lynx-icons</Text>
                            <Text class="opacity-60 text-sm">
                                Pinned per-set components from each adapter
                                (`FaSolidIcon`, `FaBrandIcon`, `LucideIcon`) —
                                each tree-shaken at build time so only the
                                referenced glyphs ship in the bundle.
                            </Text>
                            <Row gap={16} align="center">
                                <FaSolidIcon name="user" size={24} color="#0D9488" />
                                <FaSolidIcon name="house" size={24} color="#0D9488" />
                                <FaSolidIcon name="gear" size={24} color="#0D9488" />
                                <FaBrandIcon name="github" size={24} color="#222" />
                                <LucideIcon name="search" size={24} color="#0D9488" />
                                <LucideIcon name="bell" size={24} color="#0D9488" />
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Dynamic icon names</Text>
                            <Text class="opacity-60 text-sm">
                                Names come from a JS array — the JSX scanner can't
                                see them. With `include: ['*']` on the `fas` set in
                                signalx.config.ts, the full FA solid catalog is
                                bundled and these resolve at runtime.
                            </Text>
                            <Row gap={16} align="center">
                                {['rocket', 'bug', 'fire', 'star', 'heart'].map((name) => (
                                    <FaSolidIcon name={name} size={24} color="#0D9488" />
                                ))}
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Row align="center" justify="space-between">
                            <Text class="opacity-60">Version</Text>
                            <Text>0.1.0</Text>
                        </Row>
                    </Card.Body>
                </Card>
            </Col>

            <Modal open={confirmOpen.value} onClose={() => { confirmOpen.value = false; }}>
                <Modal.Header>
                    <Heading level={3}>Clear all data?</Heading>
                </Modal.Header>
                <Modal.Body>
                    <Text>
                        This will permanently remove every trip and entry.
                        This action cannot be undone.
                    </Text>
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="ghost" onPress={() => { confirmOpen.value = false; }}>
                        Cancel
                    </Button>
                    <Button variant="error" onPress={onClear}>
                        Clear
                    </Button>
                </Modal.Actions>
            </Modal>
        </ScrollView>
    );
});
