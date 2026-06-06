import { component, signal } from '@sigx/lynx';
import { Button, Col, Modal, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Modal — a live open/close dialog and a structural example showing the
 * Header / Body / Actions compound slots.
 *
 * Modal renders its overlay only while `open` is true; tapping the backdrop
 * (or calling `onClose`) dismisses it. The first section owns the `open`
 * signal that drives it.
 */
export const modalDemo: DaisyComponentDemo = {
    id: 'modal',
    title: 'Modal',
    description: 'Live open/close dialog with Header / Body / Actions slots',
    icon: { set: 'lucide', name: 'gallery-vertical-end' },
    sections: [
        {
            title: 'Open & close',
            Demo: component(() => {
                const open = signal(false);
                return () => (
                    <Col gap={12}>
                        <Button variant="primary" onPress={() => { open.value = true; }}>
                            Open modal
                        </Button>
                        <Modal open={open.value} onClose={() => { open.value = false; }}>
                            <Modal.Header><Text class="font-semibold">Confirm action</Text></Modal.Header>
                            <Modal.Body><Text>This cannot be undone. Continue?</Text></Modal.Body>
                            <Modal.Actions>
                                <Button variant="ghost" size="sm" onPress={() => { open.value = false; }}>
                                    Cancel
                                </Button>
                                <Button variant="primary" size="sm" onPress={() => { open.value = false; }}>
                                    Confirm
                                </Button>
                            </Modal.Actions>
                        </Modal>
                    </Col>
                );
            }),
        },
        {
            title: 'Compound slots',
            note: 'Header / Body / Actions kept always-open for reference',
            Demo: component(() => () => (
                <Modal open onClose={() => {}}>
                    <Modal.Header><Text class="font-semibold">Title</Text></Modal.Header>
                    <Modal.Body><Text>Body content goes here.</Text></Modal.Body>
                    <Modal.Actions>
                        <Button variant="primary" size="sm">OK</Button>
                    </Modal.Actions>
                </Modal>
            )),
        },
    ],
};
