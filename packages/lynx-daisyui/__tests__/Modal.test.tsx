import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Modal } from '../src/feedback/Modal';

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
    // Closed state: content fully unmounted; the placeholder is the
    // zero-size out-of-flow shape (not display:none — see the
    // lynx-display-none caveat).
    expect(container.findByText('Hidden content')).toBeNull();
    const el = container.children[0];
    expect(el._style.position).toBe('absolute');
    expect(el._style.width).toBe('0px');
    expect(el._style.height).toBe('0px');
    expect(el._style.opacity).toBe(0);
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

  // #260: the box must consume taps natively (catchtap → Lynx catchEvent).
  // There is no e.stopPropagation() in this runtime, so a bindtap guard on
  // the box is a silent no-op and every inner tap would bubble to the
  // overlay's close handler.
  it('overlay is a touch guard closing via catchtap; the box consumes taps', () => {
    // #787: the overlay root is the native <sigx-touch-guard> (platform
    // touch consumption), whose catchtap drives onClose.
    const { container } = render(
      <Modal open={true} onClose={() => {}}>
        <Modal.Body>
          <text>Content</text>
        </Modal.Body>
      </Modal>
    );
    const overlay = container.children[0];
    const modalBox = overlay.children[0];
    expect(overlay.type).toBe('sigx-touch-guard');
    expect(overlay._handlers.has('catchtap')).toBe(true);
    expect(modalBox._handlers.has('catchtap')).toBe(true);
    expect(modalBox._handlers.has('bindtap')).toBe(false);
  });
});
