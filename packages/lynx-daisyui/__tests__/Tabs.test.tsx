import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Tabs } from '../src/navigation/Tabs.js';

describe('Tabs', () => {
  it('renders tabs in a row', () => {
    const { container } = render(
      <Tabs>
        <Tabs.Tab value="one" label="One" />
        <Tabs.Tab value="two" label="Two" />
      </Tabs>
    );
    const tabs = container.children[0];
    expect(tabs._style.flexDirection).toBe('row');
  });

  it('renders tab labels', () => {
    const { container } = render(
      <Tabs>
        <Tabs.Tab value="one" label="First" />
        <Tabs.Tab value="two" label="Second" />
      </Tabs>
    );
    expect(container.textContent()).toContain('First');
    expect(container.textContent()).toContain('Second');
  });

  it('applies active class to active tab', () => {
    const { container } = render(
      <Tabs>
        <Tabs.Tab value="one" label="One" active={true} />
        <Tabs.Tab value="two" label="Two" active={false} />
      </Tabs>
    );
    const tabs = container.children[0];
    // Find views with tab-active class
    function findByClass(node: any, cls: string): any {
      if (node._class && node._class.includes(cls)) return node;
      for (const child of node.children || []) {
        const found = findByClass(child, cls);
        if (found) return found;
      }
      return null;
    }
    const activeTab = findByClass(tabs, 'tab-active');
    expect(activeTab).toBeTruthy();
    expect(activeTab._style.borderBottomWidth).toBe(2);
  });

  it('applies custom class to tabs container', () => {
    const { container } = render(
      <Tabs class="custom-tabs">
        <Tabs.Tab value="one" label="One" />
      </Tabs>
    );
    const tabs = container.children[0];
    expect(tabs._class).toContain('custom-tabs');
  });

  it('renders custom content in tab slot', () => {
    const { container } = render(
      <Tabs>
        <Tabs.Tab value="one" label="One">
          <text>Custom Content</text>
        </Tabs.Tab>
      </Tabs>
    );
    expect(container.textContent()).toContain('Custom Content');
  });
});
