/**
 * The view context the Lynx block components share: the editor instance,
 * the mounted surfaces by key, the open trigger session and the styling
 * props that reach every field. Provided by `<MarkdownEditor>` through an
 * injectable so nested blocks need no prop drilling.
 */

import { computed, signal, type Computed, type PrimitiveSignal } from '@sigx/lynx';
import { defineInjectable } from '@sigx/lynx';
import type { Editor, TriggerItem, TriggerSession } from '@sigx/richtext/editor';
import { selectedBlockKeys } from '@sigx/richtext/editor';
import type { AnySurface } from '@sigx/richtext/editor';
import type { SuggestionPopupStyle, SuggestionRenderItem } from './trigger/SuggestionPopup.js';
import type { LynxMarkdownComponents } from '../render/components.js';

/** Read signals for dependency tracking only (a render that depends on a revision without using its value). */
export function track(..._values: unknown[]): void {}

export interface EditorFieldStyle {
    fontSize: number;
    textColor?: string;
    accentColor?: string;
    placeholderColor?: string;
    confirmType?: 'send' | 'search' | 'next' | 'go' | 'done';
}

export interface LynxEditorView {
    readonly editor: Editor;
    readonly surfaces: Map<string, AnySurface>;
    register(key: string, surface: AnySurface): () => void;
    /** The key of the surface that has keyboard focus, or null. */
    focusedKey(): string | null;
    /** Keys of the blocks in the current block selection (empty for a text selection). */
    readonly selectedKeys: Computed<ReadonlySet<string>>;
    readOnly(): boolean;
    placeholder(): string | undefined;
    field(): EditorFieldStyle;
    components(): LynxMarkdownComponents;
    /** Bumped whenever the open trigger session changes. */
    readonly sessionRev: PrimitiveSignal<number>;
    session(): TriggerSession | null;
    readonly activeIndex: PrimitiveSignal<number>;
    /** Whether the built-in popup renders (`suggestions` prop). */
    popup(): boolean;
    popupStyle(): SuggestionPopupStyle;
    renderSuggestion(plugin: string): SuggestionRenderItem | undefined;
    pick(item: TriggerItem): void;
    closeSession(): void;
    /** Focus the surface of a block; false when it is not mounted. */
    focusBlock(key: string, target?: { edge: 'start' | 'end' } | { offset: number }): boolean;
    /** Owned by the editor component: the session manager's updates land here. */
    setSession(session: TriggerSession | null): void;
    /** A surface gained (`key`) or lost (`null`) keyboard focus — the bridges report through this. */
    reportFocus(key: string | null): void;
}

export const useLynxEditorView = defineInjectable<LynxEditorView>('LynxMarkdownEditorView', {
    hint: 'Editor block components render inside <MarkdownEditor>.',
});

export interface CreateLynxViewOptions {
    editor: Editor;
    readOnly(): boolean;
    placeholder(): string | undefined;
    field(): EditorFieldStyle;
    components(): LynxMarkdownComponents;
    popup(): boolean;
    popupStyle(): SuggestionPopupStyle;
    renderSuggestion(plugin: string): SuggestionRenderItem | undefined;
    pick(item: TriggerItem): void;
    closeSession(): void;
    /** Called after the focused key changed (the editor forwards to the core and the host's onFocus / onBlur). */
    onFocusChange(key: string | null, previous: string | null): void;
}

export function createLynxEditorView(opts: CreateLynxViewOptions): LynxEditorView {
    const { editor } = opts;
    const surfaces = new Map<string, AnySurface>();
    let session: TriggerSession | null = null;
    let focused: string | null = null;
    const sessionRev = signal(0);
    const activeIndex = signal(0);

    const selectedKeys = computed<ReadonlySet<string>>(() => {
        track(editor.selRev.value);
        const sel = editor.state.selection;
        if (!sel || sel.mode !== 'block') return new Set();
        return new Set(selectedBlockKeys(editor.state));
    });

    return {
        editor,
        surfaces,
        register(key, surface) {
            surfaces.set(key, surface);
            return () => {
                if (surfaces.get(key) === surface) surfaces.delete(key);
            };
        },
        focusedKey: () => focused,
        selectedKeys,
        readOnly: opts.readOnly,
        placeholder: opts.placeholder,
        field: opts.field,
        components: opts.components,
        sessionRev,
        session: () => {
            track(sessionRev.value);
            return session;
        },
        activeIndex,
        popup: opts.popup,
        popupStyle: opts.popupStyle,
        renderSuggestion: opts.renderSuggestion,
        pick: opts.pick,
        closeSession: opts.closeSession,
        focusBlock(key, target) {
            const s = surfaces.get(key);
            if (!s) return false;
            s.focus(target);
            return true;
        },
        setSession(s) {
            session = s;
            sessionRev.value++;
            if (!s) activeIndex.value = 0;
            else if (activeIndex.value >= s.items.length) activeIndex.value = Math.max(0, s.items.length - 1);
        },
        reportFocus(key) {
            const previous = focused;
            focused = key;
            if (key !== previous) opts.onFocusChange(key, previous);
        },
    };
}
