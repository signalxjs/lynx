import type { IconSpec } from '@sigx/lynx-icons';
import { buttonDemo } from './demos/button.js';

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
    buttonDemo,
];

export function getDaisyDemo(id: string): DaisyComponentDemo | undefined {
    return daisyDemos.find((d) => d.id === id);
}
