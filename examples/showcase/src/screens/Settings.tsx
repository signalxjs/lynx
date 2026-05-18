import { component, signal } from '@sigx/lynx';
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
import { clearAllTrips, trips } from '../store/trips.js';

export const Settings = component(() => {
    const theme = useTheme();
    const confirmOpen = signal(false);

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
