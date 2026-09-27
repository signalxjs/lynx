/**
 * The seam between `CheckboxGroup.Root` and the `Checkbox.Root`s inside it —
 * zero's `checkbox-group/context.ts`, minus the web's form plumbing (no
 * `name`/`form`/input ids: there are no forms on lynx).
 *
 * It lives apart from the group component so Checkbox reads it without
 * pulling the group in: a box outside any group sees the inert fallback
 * (`inert: true`) and behaves exactly as a standalone box.
 */
import { defineInjectable, signal } from '@sigx/lynx';
import type { ControllableState } from '@sigx/zero/behaviors/core';
import { createInertState } from '@sigx/zero/behaviors/core';

type Orientation = 'horizontal' | 'vertical';

/** One boxed child, as a parent box needs it: its membership value. */
export interface CheckboxGroupEntry {
    value(): string;
}

export interface CheckboxGroupContext {
    /** True on the fallback — a `Checkbox.Root` outside any group. */
    inert: boolean;
    state: ControllableState<string[]>;
    disabled(): boolean;
    invalid(): boolean;
    required(): boolean;
    readonly(): boolean;
    orientation(): Orientation;
    /**
     * What a parent box selects and derives from: the group's `allValues`,
     * else every registered (non-parent) child's value, in order.
     */
    allValues(): string[];
    /**
     * A child box registers on setup and withdraws on unmount — both
     * deferred a microtask (a write made during a render pass is invisible
     * to the pass rendering the parent box). Returns the withdrawal.
     */
    register(entry: CheckboxGroupEntry): () => void;
}

/**
 * Defer to the next microtask through a resolved promise — the background
 * thread lacks a bare `queueMicrotask` on some engines.
 */
const defer = (fn: () => void): void => {
    void Promise.resolve().then(fn);
};

/** The registry half of the context — the root owns one per instance. */
export function createEntryRegistry(): {
    entries(): CheckboxGroupEntry[];
    register(entry: CheckboxGroupEntry): () => void;
} {
    // Keyed by a per-registry serial: the stored array hands back proxies,
    // never the raw entry, so identity comparison would never match.
    const list = signal({ items: [] as { key: number; entry: CheckboxGroupEntry }[] });
    let serial = 0;
    return {
        entries: () => list.items.map((item) => item.entry),
        register: (entry) => {
            const key = serial++;
            let alive = true;
            let added = false;
            defer(() => {
                if (!alive) return;
                added = true;
                list.items = [...list.items, { key, entry }];
            });
            return () => {
                alive = false;
                if (added) defer(() => { list.items = list.items.filter((item) => item.key !== key); });
            };
        },
    };
}

function makeInert(): CheckboxGroupContext {
    return {
        inert: true,
        state: createInertState<string[]>([]),
        disabled: () => false,
        invalid: () => false,
        required: () => false,
        readonly: () => false,
        orientation: () => 'vertical',
        allValues: () => [],
        register: () => () => {},
    };
}

export const useCheckboxGroupContext = defineInjectable<CheckboxGroupContext>(() => makeInert());
