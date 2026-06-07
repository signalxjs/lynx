import type { IconSpec } from '@sigx/lynx-icons';
import { buttonDemo } from './demos/button.js';
import { cardDemo } from './demos/card.js';
import { inputDemo } from './demos/input.js';
import { modalDemo } from './demos/modal.js';
import { tabsDemo } from './demos/tabs.js';
import { textDemo } from './demos/text.js';
import { headingDemo } from './demos/heading.js';

/**
 * HeroUI component reference registry — single source of truth for the
 * HeroUI catalog area, the per-component pages, and search. Same shape and
 * mechanics as the DaisyUI registry (`../daisyui/registry.ts`); every entry
 * is served by the single parametric `heroui/:componentId` route
 * (`HeroUIComponentScreen`), whose sections render inside a nested
 * `<ThemeProvider initial="hero-light">` scope.
 */

/**
 * Structural component shape — matches navigation's `ComponentLike` so a
 * section's demo is any `component(...)` factory without importing sigx
 * types at value level. (`any[]` is load-bearing — see the daisyui registry.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DemoComponent = (...args: any[]) => unknown;

export interface DemoSection {
    title: string;
    /** Optional caption rendered under the section title. */
    note?: string;
    /**
     * A `component(...)` factory — not a render closure — so interactive
     * demos own their signals (created once in setup, not per re-render).
     */
    Demo: DemoComponent;
}

export interface HeroComponentDemo {
    /** Registry key; doubles as the `componentId` route param. */
    id: string;
    /** Component name as shown in lists and the page header. */
    title: string;
    /** One-liner for list rows; also matched by catalog search. */
    description: string;
    icon: IconSpec;
    sections: DemoSection[];
}

export const heroDemos: HeroComponentDemo[] = [
    // Actions
    buttonDemo,
    // Layout
    cardDemo,
    // Forms
    inputDemo,
    // Feedback
    modalDemo,
    // Navigation
    tabsDemo,
    // Typography
    textDemo,
    headingDemo,
];

export function getHeroDemo(id: string): HeroComponentDemo | undefined {
    return heroDemos.find((d) => d.id === id);
}
