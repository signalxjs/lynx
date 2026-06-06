import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Tabs } from '../src/components/Tabs';

function findByClass(node: any, cls: string): any {
  if (node._class && node._class.includes(cls)) return node;
  for (const child of node.children || []) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return null;
}

describe('hero Tabs', () => {
  it('renders the hero track and tab labels', () => {
    const { container } = render(
      <Tabs>
        <Tabs.Tab value="one" label="First" />
        <Tabs.Tab value="two" label="Second" />
      </Tabs>,
    );
    expect(container.children[0]._class).toContain('hero-tabs');
    expect(container.textContent()).toContain('First');
    expect(container.textContent()).toContain('Second');
  });

  it('marks the active tab with hero-tab-active', () => {
    const { container } = render(
      <Tabs>
        <Tabs.Tab value="one" label="One" active />
        <Tabs.Tab value="two" label="Two" active={false} />
      </Tabs>,
    );
    expect(findByClass(container, 'hero-tab-active')).toBeTruthy();
  });

  it('renders custom content in the tab slot', () => {
    const { container } = render(
      <Tabs>
        <Tabs.Tab value="one" label="One">
          <text>Custom Content</text>
        </Tabs.Tab>
      </Tabs>,
    );
    expect(container.textContent()).toContain('Custom Content');
  });
});

describe('hero Tabs — container-driven selection (#219 retro)', () => {
  it('derives active from activeTab/value without per-tab props', () => {
    const { container } = render(
      <Tabs activeTab="two">
        <Tabs.Tab value="one" label="One" />
        <Tabs.Tab value="two" label="Two" />
      </Tabs>,
    );
    const active = findByClass(container, 'hero-tab-active');
    expect(active).toBeTruthy();
    expect(active.textContent()).toContain('Two');
  });

  it('explicit active prop overrides the container selection', () => {
    const { container } = render(
      <Tabs activeTab="one">
        <Tabs.Tab value="one" label="One" active={false} />
        <Tabs.Tab value="two" label="Two" active />
      </Tabs>,
    );
    const active = findByClass(container, 'hero-tab-active');
    expect(active.textContent()).toContain('Two');
  });
});
