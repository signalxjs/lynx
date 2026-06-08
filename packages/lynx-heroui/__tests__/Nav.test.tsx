import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { NavTabBar } from '../src/components/NavTabBar';

/** Find any node carrying `cls` in its class list. */
function hasClass(node: any, cls: string): boolean {
  const c = node?._class ?? node?.props?.class;
  if (typeof c === 'string' && c.split(' ').includes(cls)) return true;
  for (const child of node?.children ?? []) if (hasClass(child, cls)) return true;
  return false;
}

const ITEMS = [
  { name: 'home', label: 'Home' },
  { name: 'search', label: 'Search' },
  { name: 'profile', label: 'Profile' },
];

describe('hero NavTabBar (standalone mode)', () => {
  it('renders the item labels', () => {
    const { container } = render(<NavTabBar items={ITEMS} activeId="home" />);
    expect(container.findByText('Home')).toBeTruthy();
    expect(container.findByText('Search')).toBeTruthy();
    expect(container.findByText('Profile')).toBeTruthy();
  });

  it('default bottom bar gets the top separator', () => {
    const { container } = render(<NavTabBar items={ITEMS} activeId="home" />);
    expect(hasClass(container, 'border-t')).toBe(true);
  });

  it('position="top" flips the separator to the bottom edge', () => {
    const { container } = render(<NavTabBar items={ITEMS} activeId="home" position="top" />);
    expect(hasClass(container, 'border-b')).toBe(true);
    expect(hasClass(container, 'border-t')).toBe(false);
  });

  it('bordered={false} drops the separator', () => {
    const { container } = render(<NavTabBar items={ITEMS} activeId="home" bordered={false} />);
    expect(hasClass(container, 'border-t')).toBe(false);
  });

  it('the active tab label tone is primary', () => {
    const { container } = render(<NavTabBar items={ITEMS} activeId="search" />);
    // active label uses text-primary; inactive uses text-base-content
    expect(hasClass(container, 'text-primary')).toBe(true);
  });

  it('applies the surface background token', () => {
    const { container } = render(<NavTabBar items={ITEMS} activeId="home" background="base-100" />);
    expect(hasClass(container, 'bg-base-100')).toBe(true);
  });
});
