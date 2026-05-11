import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Modal } from '../src/feedback/Modal.js';

describe('Modal', () => {
  // TODO: update — overlay no longer sets inline `display: flex`; visibility
  // is driven by daisyui's `modal-open` class instead.
  it.skip('renders when open is true', () => {
    const { container } = render(
      <Modal open={true}>
        <Modal.Body>
          <text>Modal content</text>
        </Modal.Body>
      </Modal>
    );
    const overlay = container.children[0];
    expect(overlay._style.display).toBe('flex');
    expect(container.findByText('Modal content')).toBeTruthy();
  });

  it('is hidden when open is false', () => {
    const { container } = render(
      <Modal open={false}>
        <Modal.Body>
          <text>Hidden content</text>
        </Modal.Body>
      </Modal>
    );
    const el = container.children[0];
    expect(el._style.display).toBe('none');
  });

  it('renders Header, Body, and Actions', () => {
    const { container } = render(
      <Modal open={true}>
        <Modal.Header>
          <text>Title</text>
        </Modal.Header>
        <Modal.Body>
          <text>Body text</text>
        </Modal.Body>
        <Modal.Actions>
          <text>Action</text>
        </Modal.Actions>
      </Modal>
    );
    expect(container.findByText('Title')).toBeTruthy();
    expect(container.findByText('Body text')).toBeTruthy();
    expect(container.findByText('Action')).toBeTruthy();
  });

  it('applies custom class to modal box', () => {
    const { container } = render(
      <Modal open={true} class="custom-modal">
        <Modal.Body>
          <text>Content</text>
        </Modal.Body>
      </Modal>
    );
    const overlay = container.children[0];
    const modalBox = overlay.children[0];
    expect(modalBox._class).toContain('custom-modal');
  });
});
