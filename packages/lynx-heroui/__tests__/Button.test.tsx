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

describe('hero Button — accessibility passthrough (#237)', () => {
  function findWithProp(node: any, key: string): any {
    if (node.props && node.props[key] !== undefined) return node;
    for (const child of node.children || []) {
      const found = findWithProp(child, key);
      if (found) return found;
    }
    return null;
  }

  it('forwards accessibility props to the pressable host view', () => {
    const { container } = render(
      <Button color="primary" accessibility-label="Get started" accessibility-role="button">hi</Button>,
    );
    const host = findWithProp(container, 'accessibility-label');
    expect(host).toBeTruthy();
    expect(host.props['accessibility-label']).toBe('Get started');
    expect(host._class).toContain('hero-btn');
  });
});
