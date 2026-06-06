import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Button } from '../src/components/Button';

describe('hero Button — shared contract shape (#219)', () => {
  it('defaults to solid neutral', () => {
    const { container } = render(<Button>hi</Button>);
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-btn');
    expect(cls).toContain('hero-btn-neutral');
  });

  it('composes semantic color and fill-style variant', () => {
    const { container } = render(
      <Button color="primary" variant="bordered">hi</Button>,
    );
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-btn-primary');
    expect(cls).toContain('hero-btn-bordered');
  });

  it('solid is the default variant (no extra class)', () => {
    const { container } = render(<Button color="success" variant="solid">hi</Button>);
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-btn-success');
    expect(cls).not.toContain('hero-btn-solid');
  });

  it('applies size and disabled state', () => {
    const { container } = render(<Button color="primary" size="sm" disabled>hi</Button>);
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('hero-btn-sm');
    expect(cls).toContain('hero-btn-disabled');
  });
});
