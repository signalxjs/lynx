import type { IconSpec } from '@sigx/lynx-icons';
import { buttonDemo } from './demos/button.js';
import { cardDemo } from './demos/card.js';
import { inputDemo } from './demos/input.js';
import { textareaDemo } from './demos/textarea.js';
import { toggleDemo } from './demos/toggle.js';
import { checkboxDemo } from './demos/checkbox.js';
import { radioDemo } from './demos/radio.js';
import { selectDemo } from './demos/select.js';
import { formfieldDemo } from './demos/formfield.js';
import { dividerDemo } from './demos/divider.js';
import { badgeDemo } from './demos/badge.js';
import { alertDemo } from './demos/alert.js';
import { loadingDemo } from './demos/loading.js';
import { progressDemo } from './demos/progress.js';
import { skeletonDemo } from './demos/skeleton.js';
import { stepsDemo } from './demos/steps.js';
import { avatarDemo } from './demos/avatar.js';
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
    textareaDemo,
    toggleDemo,
    checkboxDemo,
    radioDemo,
    selectDemo,
    formfieldDemo,
    // Layout
    dividerDemo,
    // Feedback
    badgeDemo,
    alertDemo,
    loadingDemo,
    progressDemo,
    skeletonDemo,
    stepsDemo,
    modalDemo,
    // Data
    avatarDemo,
    // Navigation
    tabsDemo,
    // Typography
    textDemo,
    headingDemo,
];

export function getHeroDemo(id: string): HeroComponentDemo | undefined {
    return heroDemos.find((d) => d.id === id);
}
