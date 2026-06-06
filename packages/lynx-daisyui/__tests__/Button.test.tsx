import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Button } from '../src/buttons/Button';

describe('Button — color/variant split (#219 contract)', () => {
  it('composes semantic color and fill-style variant', () => {
    const { container } = render(
      <Button color="primary" variant="outline">hi</Button>,
    );
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('btn');
    expect(cls).toContain('btn-primary');
    expect(cls).toContain('btn-outline');
  });

  it('renders color alone', () => {
    const { container } = render(<Button color="error">hi</Button>);
    expect(container.children[0]._class).toContain('btn-error');
  });

  it('renders fill-style variants without a color', () => {
    const { container } = render(<Button variant="ghost">hi</Button>);
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('btn-ghost');
    expect(cls.some((c) => /^btn-(primary|secondary|accent|neutral|info|success|warning|error)$/.test(c))).toBe(false);
  });

  it('applies size and modifier classes', () => {
    const { container } = render(
      <Button color="primary" size="sm" wide block>hi</Button>,
    );
    const cls = container.children[0]._class.split(' ');
    expect(cls).toContain('btn-sm');
    expect(cls).toContain('btn-wide');
    expect(cls).toContain('btn-block');
  });
});

describe('Button — accessibility passthrough (#237)', () => {
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
      <Button
        color="primary"
        accessibility-element
        accessibility-label="Sign in"
        accessibility-role="button"
      >
        hi
      </Button>,
    );
    const host = findWithProp(container, 'accessibility-label');
    expect(host).toBeTruthy();
    expect(host.props['accessibility-label']).toBe('Sign in');
    expect(host.props['accessibility-role']).toBe('button');
    expect(host.props['accessibility-element']).toBe(true);
    // metadata sits on the same node that carries the btn classes (the
    // gesture host), not a wrapper
    expect(host._class).toContain('btn');
  });
});
