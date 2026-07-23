import { describe, it, expect, vi } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Modal } from '../src/components/Modal';

describe('hero Modal', () => {
  it('renders nothing visible when closed', () => {
    const { container } = render(
      <Modal open={false}><text>content</text></Modal>,
    );
    expect(container.findByText('content')).toBeNull();
  });

  it('renders overlay + box when open', () => {
    const { container } = render(
      <Modal open>
        <Modal.Header><text>title</text></Modal.Header>
        <Modal.Body><text>content</text></Modal.Body>
      </Modal>,
    );
    expect(container.children[0]._class).toContain('hero-modal-overlay');
    expect(container.findByText('content')).toBeTruthy();
  });

  it('overlay tap calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose}><text>content</text></Modal>,
    );
    const overlay = container.children[0];
    // #787: the overlay is a native touch guard; its catchtap closes.
    expect(overlay.type).toBe('sigx-touch-guard');
    overlay._handlers.get('catchtap')?.({});
    expect(onClose).toHaveBeenCalledOnce();
  });
});
