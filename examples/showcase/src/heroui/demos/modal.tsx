import { component, signal } from '@sigx/lynx';
import { Button, Col, Heading, Modal, Row, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/**
 * Modal — overlay dialog with Header/Body/Actions compound sections.
 * Closed state renders a zero-size placeholder (fully unmounted content),
 * dismisses on overlay tap or Actions.
 */
export const modalDemo: HeroComponentDemo = {
    id: 'modal',
    title: 'Modal',
    description: 'Overlay dialog — Header/Body/Actions, overlay-tap dismiss',
    icon: { set: 'lucide', name: 'panel-top-open' },
    sections: [
        {
            title: 'Basic',
            note: 'Tap the overlay or Done to dismiss',
            Demo: component(() => {
                const open = signal(false);
                return () => (
                    <Col gap={8}>
                        <Row gap={8}>
                            <Button color="primary" onPress={() => { open.value = true; }}>
                                Open modal
                            </Button>
                        </Row>
                        <Modal open={open.value} onClose={() => { open.value = false; }}>
                            <Modal.Header>
                                <Heading level={4}>Hero modal</Heading>
                            </Modal.Header>
                            <Modal.Body>
                                <Text size="sm">
                                    Rendered in the hero theme scope; the box uses the
                                    hero radius and base surface tokens.
                                </Text>
                            </Modal.Body>
                            <Modal.Actions>
                                <Button color="primary" size="sm" onPress={() => { open.value = false; }}>
                                    Done
                                </Button>
                            </Modal.Actions>
                        </Modal>
                    </Col>
                );
            }),
        },
        {
            title: 'Confirmation pattern',
            Demo: component(() => {
                const open = signal(false);
                const result = signal('');
                return () => (
                    <Col gap={8}>
                        <Row gap={12} align="center">
                            <Button color="error" variant="flat" onPress={() => { open.value = true; }}>
                                Delete item
                            </Button>
                            <Text size="sm" class="opacity-60">{result.value}</Text>
                        </Row>
                        <Modal open={open.value} onClose={() => { open.value = false; }}>
                            <Modal.Header>
                                <Heading level={4}>Delete item?</Heading>
                            </Modal.Header>
                            <Modal.Body>
                                <Text size="sm">This action cannot be undone.</Text>
                            </Modal.Body>
                            <Modal.Actions>
                                <Button size="sm" variant="ghost" onPress={() => { result.value = 'cancelled'; open.value = false; }}>
                                    Cancel
                                </Button>
                                <Button color="error" size="sm" onPress={() => { result.value = 'deleted'; open.value = false; }}>
                                    Delete
                                </Button>
                            </Modal.Actions>
                        </Modal>
                    </Col>
                );
            }),
        },
    ],
};
