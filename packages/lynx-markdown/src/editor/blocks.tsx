/**
 * The Lynx block views of `<MarkdownEditor>`, dispatched on the schema kind:
 *
 *  - `inline` → `<InlineBlock>`: one `<RichTextInput boundaryKeys>` owned by
 *    a `LynxInlineSurface`, wired to the core through the inline bridge;
 *  - `code` → `<CodeBlock>`: a `<textarea>` `LynxCodeSurface` with a
 *    language field and a "done" affordance (the textarea reports no keys);
 *  - `void` → rendered read-only through the Lynx components, selectable
 *    as a block on tap;
 *  - `container` → lists (with markers and task checkboxes), quotes;
 *  - `table` → rows of inline blocks.
 *
 * After every committed transaction a block pushes the new content only
 * when its node identity changed (structural sharing makes an untouched
 * block free) and takes the caret when the selection points at it and the
 * editor has focus. The suggestion popup renders inside the inline block
 * the open session belongs to, so caret rects stay block-relative.
 */

import { component, toRaw, useElementLayout, useViewportRect, type Define, type JSXElement } from '@sigx/lynx';
import type { BlockContent, List, ListItem, Table, TableRow } from '@sigx/markdown';
import { renderBlock, type RenderContext } from '@sigx/markdown';
import type { EditorBlock, EditorState, InlineSurfaceEvents, CodeSurfaceEvents, Transaction } from '@sigx/markdown/editor';
import { commands as C, createCodeBridge, createInlineBridge, type BridgeHost } from '@sigx/markdown/editor';
import { RichTextInput, type RichTextHandle } from '@sigx/lynx-richtext';
import { createLynxInlineSurface, type LynxInlineSurface } from './surface/inline-surface.js';
import { createLynxCodeSurface, type LynxCodeSurface } from './surface/code-surface.js';
import { track, useLynxEditorView, type LynxEditorView } from './view.js';
import { SuggestionPopup } from './trigger/SuggestionPopup.js';

function bridgeHost(view: LynxEditorView): BridgeHost {
    const { editor } = view;
    return {
        dispatch: editor.dispatch,
        runKey: editor.runKey,
        setSelection: editor.setSelection,
        paste: editor.paste,
        flatOf: editor.flatOf,
        valueOf: editor.valueOf,
        focused: (key) => view.reportFocus(key),
    };
}

function attrsOf(node: EditorBlock): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && k !== 'children' && k !== 'position' && k !== 'key') out[k] = v;
    return out;
}

function rangeOf(state: EditorState, key: string): { start: number; end: number } | null {
    const sel = state.selection;
    if (!sel || sel.mode !== 'text' || sel.anchor.key !== key) return null;
    return { start: Math.min(sel.anchor.offset, sel.head.offset), end: Math.max(sel.anchor.offset, sel.head.offset) };
}

const SELECTED_BG = 'rgba(128,128,255,0.18)';

// ---------------------------------------------------------------------------
// Inline block
// ---------------------------------------------------------------------------

export type InlineBlockProps = Define.Prop<'block', EditorBlock, true>;

export const InlineBlock = component<InlineBlockProps>(({ props, onUnmounted, signal }) => {
    const view = useLynxEditorView();
    const { editor } = view;
    const key = props.block.key!;
    let handle: RichTextHandle = null;
    let lastNode: EditorBlock = toRaw(props.block);
    const editable = signal({ value: !view.readOnly() });
    // Lynx sizes views from styles, never from native intrinsic content: the
    // element reports its content height and the block feeds it back as the
    // element's layout height (auto-grow).
    const reported = signal({ height: 0 });
    // The field's frame anchors the popup against the keyboard: the measured
    // viewport rect wins (transform-aware, #755), the layout event is the
    // first-paint fallback and the "something moved, re-measure" signal.
    const { ref: frameRef, rect: measured, measure } = useViewportRect();
    const { layout, onLayoutChange } = useElementLayout();
    const frame = () => measured.value ?? layout.value;

    const bridge = createInlineBridge(key, bridgeHost(view));
    const events: InlineSurfaceEvents = {
        ...bridge.events,
        boundary: (e) => {
            // An open suggestion session owns the navigation keys.
            const session = view.session();
            if (session && session.key === key) {
                const n = session.items.length;
                switch (e.key) {
                    case 'ArrowDown':
                        if (n) view.activeIndex.value = (view.activeIndex.value + 1) % n;
                        return true;
                    case 'ArrowUp':
                        if (n) view.activeIndex.value = (view.activeIndex.value - 1 + n) % n;
                        return true;
                    case 'Enter':
                    case 'Tab': {
                        const item = session.items[view.activeIndex.value];
                        if (item) view.pick(item);
                        else view.closeSession();
                        return true;
                    }
                    case 'Escape':
                        view.closeSession();
                        return true;
                }
            }
            return bridge.events.boundary(e);
        },
    };

    const surface: LynxInlineSurface = createLynxInlineSurface(
        { key, blockType: lastNode.type, attrs: attrsOf(lastNode), flat: editor.flatOf(key) ?? { text: '', spans: [] }, readOnly: view.readOnly(), events },
        {
            handle: () => handle,
            onReadOnly: (ro) => {
                editable.value = !ro;
            },
        },
    );
    const unregister = view.register(key, surface);

    const syncSelection = (tr: Transaction, state: EditorState): void => {
        const range = rangeOf(state, key);
        if (!range) return;
        if (tr.meta.origin === 'surface' && tr.meta.sourceKey === key) return;
        if (view.focusedKey() === null && tr.meta.origin === 'external') return;
        const current = surface.getSelection();
        if (surface.focused && current && current.start === range.start && current.end === range.end) return;
        surface.focus();
        surface.setSelection(range);
    };

    const stop = editor.listen((tr, state) => {
        const entry = state.index().get(key);
        if (!entry) return;
        if (entry.node !== lastNode) {
            lastNode = entry.node;
            if (bridge.shouldPush(tr)) {
                const flat = editor.flatOf(key);
                if (flat) surface.setInline(flat, { rev: state.rev });
                surface.setAttrs(entry.node.type, attrsOf(entry.node));
            }
        }
        syncSelection(tr, state);
    });

    onUnmounted(() => {
        stop();
        unregister();
        surface.destroy();
    });

    return (): JSXElement => {
        const node = toRaw(props.block);
        const field = view.field();
        const doc = editor.state.doc;
        track(editor.rev.value, view.sessionRev.value);
        const placeholder = doc.children.length === 1 && doc.children[0] === node ? view.placeholder() : undefined;
        const session = view.session();
        const mine = !!session && session.key === key && view.popup() && session.items.length > 0 && !!frame();
        if (mine && !measured.value) measure();
        const popupStyle = view.popupStyle();
        const minHeight = Math.round(field.fontSize * 1.5) + 16;
        return (
            <view
                main-thread:ref={frameRef}
                bindlayoutchange={(e) => {
                    onLayoutChange(e);
                    if (mine) measure();
                }}
                data-key={key}
                style={{ position: 'relative', overflow: 'visible' }}
            >
                <RichTextInput
                    value={surface.initialDoc}
                    boundaryKeys
                    editable={editable.value}
                    placeholder={placeholder}
                    fontSize={field.fontSize}
                    textColor={field.textColor}
                    accentColor={field.accentColor}
                    placeholderColor={field.placeholderColor}
                    confirmType={field.confirmType}
                    minHeight={minHeight}
                    style={{ height: Math.max(minHeight, reported.height) }}
                    onHeightChange={(h) => {
                        reported.height = h;
                    }}
                    onElement={(h) => {
                        handle = h;
                        if (h) surface.native.attached();
                    }}
                    onChange={(d, composing) => surface.native.change(d, composing)}
                    onSelection={(sel) => surface.native.selection(sel)}
                    onBoundaryKey={(e) => surface.native.boundaryKey(e)}
                    onFocus={() => surface.native.focus()}
                    onBlur={() => surface.native.blur()}
                />
                {mine ? (
                    <SuggestionPopup
                        items={session.items}
                        caretRect={surface.caretRect()}
                        containerFrame={frame()}
                        onMeasureRequest={measure}
                        renderItem={view.renderSuggestion(session.plugin)}
                        onSelect={(item) => view.pick(item)}
                        activeIndex={view.activeIndex.value}
                        {...popupStyle}
                    />
                ) : null}
            </view>
        );
    };
});

// ---------------------------------------------------------------------------
// Code block
// ---------------------------------------------------------------------------

interface CodeLike {
    type: string;
    value: string;
    lang?: string | null;
}

export const CodeBlock = component<{ block: EditorBlock }>(({ props, onUnmounted, signal }) => {
    const view = useLynxEditorView();
    const { editor } = view;
    const key = props.block.key!;
    let lastNode: EditorBlock = toRaw(props.block);
    const state = signal({ value: (lastNode as unknown as CodeLike).value, lang: (lastNode as unknown as CodeLike).lang ?? null, focus: false });

    const bridge = createCodeBridge(key, bridgeHost(view));
    const events: CodeSurfaceEvents = bridge.events;
    const surface: LynxCodeSurface = createLynxCodeSurface(
        { key, value: state.value, lang: state.lang, readOnly: view.readOnly(), events },
        {
            onValue: (v) => {
                state.value = v;
            },
            onLang: (l) => {
                state.lang = l;
            },
            onFocusRequest: (focus) => {
                state.focus = focus;
            },
        },
    );
    const unregister = view.register(key, surface);

    const stop = editor.listen((tr, s) => {
        const entry = s.index().get(key);
        if (!entry) return;
        if (entry.node !== lastNode) {
            lastNode = entry.node;
            if (bridge.shouldPush(tr)) {
                surface.setValue((entry.node as unknown as CodeLike).value);
                surface.setLang((entry.node as unknown as CodeLike).lang ?? null);
            }
        }
        const range = rangeOf(s, key);
        if (range && !(tr.meta.origin === 'surface' && tr.meta.sourceKey === key) && !surface.focused) surface.focus({ offset: range.start });
    });

    onUnmounted(() => {
        stop();
        unregister();
    });

    return (): JSXElement => {
        const node = toRaw(props.block) as unknown as CodeLike;
        const field = view.field();
        return (
            <view style={{ display: 'flex', flexDirection: 'column', borderRadius: 6, backgroundColor: 'rgba(128,128,128,0.12)', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
                {node.type === 'code' ? (
                    <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <input
                            value={state.lang ?? ''}
                            placeholder="language"
                            disabled={view.readOnly()}
                            style={{ fontSize: 12, ...(field.textColor ? { color: field.textColor } : {}), opacity: 0.7, flexGrow: 1 }}
                            bindinput={(e: { detail: { value: string } }) => {
                                const v = (e.detail?.value ?? '').trim();
                                state.lang = v || null;
                                events.langChange?.(v || null);
                            }}
                        />
                        <view
                            ignore-focus
                            accessibility-element
                            accessibility-label="Leave code block"
                            accessibility-trait="button"
                            bindtap={() => {
                                editor.setSelection({ mode: 'text', anchor: { key, offset: state.value.length }, head: { key, offset: state.value.length } });
                                editor.run(C.exitCode);
                            }}
                            style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}
                        >
                            <text style={{ fontSize: 12, ...(field.accentColor ? { color: field.accentColor } : {}) }}>done</text>
                        </view>
                    </view>
                ) : null}
                <textarea
                    value={state.value}
                    disabled={view.readOnly()}
                    focus={state.focus}
                    auto-height
                    style={{ fontFamily: 'monospace', fontSize: field.fontSize - 2, ...(field.textColor ? { color: field.textColor } : {}), minHeight: 44 }}
                    bindinput={(e: { detail: { value: string } }) => {
                        const v = e.detail?.value ?? '';
                        state.value = v;
                        surface.native.input(v);
                    }}
                    bindfocus={() => surface.native.focus()}
                    bindblur={() => surface.native.blur()}
                />
            </view>
        );
    };
});

// ---------------------------------------------------------------------------
// Void, containers, table, dispatcher
// ---------------------------------------------------------------------------

const VoidBlock = component<{ block: EditorBlock }>(({ props }) => {
    const view = useLynxEditorView();
    const key = props.block.key!;
    return () => {
        const node = toRaw(props.block) as BlockContent;
        const ctx: RenderContext<JSXElement> = { components: view.components() };
        const rendered = renderBlock(node, ctx, key);
        return (
            <view
                accessibility-element
                accessibility-label={node.type === 'thematicBreak' ? 'Divider' : node.type}
                bindtap={() => {
                    if (!view.readOnly()) view.editor.run(C.selectBlock(key));
                }}
            >
                {rendered ?? <text>{node.type}</text>}
            </view>
        );
    };
});

function wrapperStyle(view: LynxEditorView, key: string): Record<string, string | number> {
    return view.selectedKeys.value.has(key) ? { backgroundColor: SELECTED_BG, borderRadius: 6 } : {};
}

const ListItemView = component<{ item: ListItem; index: number; ordered: boolean; start: number }>(({ props }) => {
    const view = useLynxEditorView();
    return () => {
        const item = toRaw(props.item);
        const task = item.checked !== null && item.checked !== undefined;
        const marker = props.ordered ? `${props.start + props.index}.` : '•';
        const field = view.field();
        return (
            <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', ...wrapperStyle(view, item.key!) }}>
                <view
                    style={{ width: 24, paddingTop: 10, alignItems: 'center' }}
                    bindtap={() => {
                        if (task && !view.readOnly()) view.editor.run(C.toggleTaskChecked(item.key!));
                    }}
                >
                    <text style={{ fontSize: field.fontSize, ...(field.textColor ? { color: field.textColor } : {}) }}>{task ? (item.checked ? '☑' : '☐') : marker}</text>
                </view>
                <view style={{ flexGrow: 1, flexShrink: 1, display: 'flex', flexDirection: 'column' }}>
                    {item.children.map((child) => (
                        <BlockView key={child.key} block={child} />
                    ))}
                </view>
            </view>
        );
    };
});

const TableBlock = component<{ block: Table }>(({ props }) => {
    const view = useLynxEditorView();
    return () => {
        const table = toRaw(props.block);
        return (
            <view style={{ display: 'flex', flexDirection: 'column', borderWidth: 1, borderColor: 'rgba(128,128,128,0.35)', borderRadius: 4, ...wrapperStyle(view, table.key!) }}>
                {table.children.map((row: TableRow, r) => (
                    <view key={row.key} style={{ display: 'flex', flexDirection: 'row', ...(r === 0 ? { backgroundColor: 'rgba(128,128,128,0.12)' } : {}) }}>
                        {row.children.map((cell) => (
                            <view key={cell.key} style={{ flexGrow: 1, flexBasis: 0, borderWidth: 0.5, borderColor: 'rgba(128,128,128,0.35)' }}>
                                <InlineBlock block={cell} />
                            </view>
                        ))}
                    </view>
                ))}
            </view>
        );
    };
});

export type BlockViewProps = Define.Prop<'block', EditorBlock, true>;

export const BlockView = component<BlockViewProps>(({ props }) => {
    const view = useLynxEditorView();
    const { editor } = view;
    return (): JSXElement => {
        const node = toRaw(props.block);
        const kind = editor.schema.kind(node.type) ?? 'void';
        track(view.selectedKeys.value);
        switch (kind) {
            case 'inline':
                return (
                    <view style={wrapperStyle(view, node.key!)}>
                        <InlineBlock block={node} />
                    </view>
                );
            case 'code':
                return (
                    <view style={{ paddingTop: 4, paddingBottom: 4, ...wrapperStyle(view, node.key!) }}>
                        <CodeBlock block={node} />
                    </view>
                );
            case 'table':
                return <TableBlock block={node as Table} />;
            case 'container': {
                if (node.type === 'list') {
                    const list = node as List;
                    return (
                        <view style={{ display: 'flex', flexDirection: 'column', ...wrapperStyle(view, list.key!) }}>
                            {list.children.map((item, i) => (
                                <ListItemView key={item.key} item={item} index={i} ordered={!!list.ordered} start={list.start ?? 1} />
                            ))}
                        </view>
                    );
                }
                if (node.type === 'listItem') {
                    return <ListItemView item={node as ListItem} index={0} ordered={false} start={1} />;
                }
                const children = ((node as { children?: EditorBlock[] }).children ?? []).map((child) => <BlockView key={child.key} block={child} />);
                return (
                    <view style={{ display: 'flex', flexDirection: 'column', paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: 'rgba(128,128,128,0.4)', marginTop: 4, marginBottom: 4, ...wrapperStyle(view, node.key!) }}>
                        {children}
                    </view>
                );
            }
            default:
                return (
                    <view style={{ paddingTop: 4, paddingBottom: 4, ...wrapperStyle(view, node.key!) }}>
                        <VoidBlock block={node} />
                    </view>
                );
        }
    };
});
