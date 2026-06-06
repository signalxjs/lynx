import { component, signal } from '@sigx/lynx';
import { Button, Col, Modal, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Modal — live open/close dialogs exercising the Header / Body / Actions
 * compound slots and backdrop dismissal.
 *
 * Modal renders its overlay only while `open` is true; tapping the backdrop
 * (or calling `onClose`) dismisses it. Each section owns the `open` signal
 * that drives its dialog — a modal is never left permanently open, since the
 * overlay would cover the catalog page.
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
                        <Button color="primary" onPress={() => { open.value = true; }}>
                            Open modal
                        </Button>
                        <Modal open={open.value} onClose={() => { open.value = false; }}>
                            <Modal.Header><Text class="font-semibold">Confirm action</Text></Modal.Header>
                            <Modal.Body><Text>This cannot be undone. Continue?</Text></Modal.Body>
                            <Modal.Actions>
                                <Button variant="ghost" size="sm" onPress={() => { open.value = false; }}>
                                    Cancel
                                </Button>
                                <Button color="primary" size="sm" onPress={() => { open.value = false; }}>
                                    Confirm
                                </Button>
                            </Modal.Actions>
                        </Modal>
                    </Col>
                );
            }),
        },
        {
            title: 'Backdrop dismiss',
            note: 'no action buttons — tapping the backdrop calls onClose',
            Demo: component(() => {
                const open = signal(false);
                return () => (
                    <Col gap={12}>
                        <Button color="secondary" onPress={() => { open.value = true; }}>
                            Open (tap backdrop to close)
                        </Button>
                        <Modal open={open.value} onClose={() => { open.value = false; }}>
                            <Modal.Header><Text class="font-semibold">Title</Text></Modal.Header>
                            <Modal.Body><Text>Body content goes here. Dismiss by tapping outside.</Text></Modal.Body>
                        </Modal>
                    </Col>
                );
            }),
        },
    ],
};
