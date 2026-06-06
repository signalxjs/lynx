import type { IconSpec } from '@sigx/lynx-icons';
// Actions
import { buttonDemo } from './demos/button.js';
// Layout
import { cardDemo } from './demos/card.js';
import { layoutDemo } from './demos/layout.js';
import { scrollviewDemo } from './demos/scrollview.js';
import { dividerDemo } from './demos/divider.js';
// Forms
import { inputDemo } from './demos/input.js';
import { textareaDemo } from './demos/textarea.js';
import { selectDemo } from './demos/select.js';
import { checkboxDemo } from './demos/checkbox.js';
import { radioDemo } from './demos/radio.js';
import { toggleDemo } from './demos/toggle.js';
import { formfieldDemo } from './demos/formfield.js';
// Feedback
import { badgeDemo } from './demos/badge.js';
import { alertDemo } from './demos/alert.js';
import { loadingDemo } from './demos/loading.js';
import { progressDemo } from './demos/progress.js';
import { modalDemo } from './demos/modal.js';
import { skeletonDemo } from './demos/skeleton.js';
import { stepsDemo } from './demos/steps.js';
// Navigation
import { tabsDemo } from './demos/tabs.js';
import { navtabbarDemo } from './demos/navtabbar.js';
import { navheaderDemo } from './demos/navheader.js';
import { navdrawerDemo } from './demos/navdrawer.js';
import { swiperindicatorDemo } from './demos/swiperindicator.js';
// Data
import { avatarDemo } from './demos/avatar.js';
// Typography
import { textDemo } from './demos/text.js';
import { headingDemo } from './demos/heading.js';

/**
 * DaisyUI component reference registry — single source of truth for the
 * DaisyUI catalog area, the per-component pages, and search.
 *
 * One entry per `@sigx/lynx-daisyui` component; each entry's sections render
 * the component's variants/sizes/states. All entries are served by the single
 * parametric `daisyui/:componentId` route (`DaisyComponentScreen`), mirroring
 * how `AreaScreen` serves every catalog area.
 */

/**
 * Structural component shape — matches navigation's `ComponentLike` so a
 * section's demo is any `component(...)` factory without importing sigx
 * types at value level.
 *
 * `any[]` (not `unknown[]`/`never[]`) is load-bearing: the JSX checker
 * requires `<section.Demo />`'s props to be assignable to the factory's
 * parameter type (`StripForJSX<…>`), which only `any` satisfies both ways.
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

export interface DaisyComponentDemo {
    /** Registry key; doubles as the `componentId` route param. */
    id: string;
    /** Component name as shown in lists and the page header. */
    title: string;
    /** One-liner for list rows; also matched by catalog search. */
    description: string;
    icon: IconSpec;
    sections: DemoSection[];
}

export const daisyDemos: DaisyComponentDemo[] = [
    // Actions
    buttonDemo,
    // Layout
    cardDemo,
    layoutDemo,
    scrollviewDemo,
    dividerDemo,
    // Forms
    inputDemo,
    textareaDemo,
    selectDemo,
    checkboxDemo,
    radioDemo,
    toggleDemo,
    formfieldDemo,
    // Feedback
    badgeDemo,
    alertDemo,
    loadingDemo,
    progressDemo,
    modalDemo,
    skeletonDemo,
    stepsDemo,
    // Navigation
    tabsDemo,
    navtabbarDemo,
    navheaderDemo,
    navdrawerDemo,
    swiperindicatorDemo,
    // Data
    avatarDemo,
    // Typography
    textDemo,
    headingDemo,
];

export function getDaisyDemo(id: string): DaisyComponentDemo | undefined {
    return daisyDemos.find((d) => d.id === id);
}
