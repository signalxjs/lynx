/**
 * The suggestion popup: placement math, measurement requests, and the
 * editor's trigger sessions (the core's session manager drives the Lynx
 * popup; hosts can render suggestions themselves — #755).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitForUpdate, type TestNode } from '@sigx/lynx-testing';
import type { TriggerItem, TriggerSession } from '@sigx/markdown/editor';
import { placeSuggestionPopup } from '../src/editor/trigger/position';
import { SuggestionPopup } from '../src/editor/trigger/SuggestionPopup';
import { createMentionPlugin } from '../src/plugins/mention';
import { installFakeElement, layoutFields, mountEditor, press, resetFakeElement, tapAt, typeIn } from './editor/harness';

describe('placeSuggestionPopup', () => {
    const base = {
        caretRect: { x: 30, y: 100, height: 18 },
        containerTop: 400,
        containerWidth: 320,
        containerHeight: 140,
        screenHeight: 800,
        keyboardHeight: 300,
        popupWidth: 240,
        maxPopupHeight: 220,
    };

    it('places above the caret by default (bottom-anchored)', () => {
        const pos = placeSuggestionPopup(base);
        expect(pos.placement).toBe('above');
        expect(pos.bottom).toBe(140 - 100 + 4);
        expect(pos.top).toBeUndefined();
    });

    it('flips below when there is no room above', () => {
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 4, height: 18 },
        });
        expect(pos.placement).toBe('below');
        expect(pos.top).toBe(4 + 18 + 4);
    });

    it('clamps maxHeight so the popup never extends under the keyboard', () => {
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 4, height: 18 },
            // keyboard top at 500; caret bottom at 22 → space below ≈ 474, clamp at maxPopupHeight
        });
        expect(pos.maxHeight).toBeLessThanOrEqual(base.maxPopupHeight);

        const tight = placeSuggestionPopup({
            ...base,
            containerTop: 350,
            caretRect: { x: 30, y: 10, height: 18 },
            screenHeight: 800,
            keyboardHeight: 380, // keyboard top at 420 — just below the caret
        });
        // 420 - (350+10+18) - 4 = 38 below; above has 350+10-4 = 356.
        expect(tight.placement).toBe('above');
        expect(tight.maxHeight).toBeLessThanOrEqual(base.maxPopupHeight);
    });

    it('never exceeds the available space, even below one row', () => {
        // Caret near the top of a screen-top container, keyboard nearly
        // covering everything: both sides are tight, above wins, and the
        // popup must shrink to the space rather than overflow.
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 20, height: 18 },
            screenHeight: 800,
            keyboardHeight: 770, // keyboard top at 30 — almost no room anywhere
        });
        expect(pos.placement).toBe('above');
        expect(pos.maxHeight).toBeLessThanOrEqual(20 - 4); // spaceAbove
    });

    it('clamps left so the popup stays inside the container', () => {
        const pos = placeSuggestionPopup({ ...base, caretRect: { x: 310, y: 100, height: 18 } });
        expect(pos.left).toBe(320 - 240);
    });

    // #755: a composer inside a <BottomSheet>. The sheet's panel is laid out
    // as a `maxHeight`-tall box pinned to the page bottom and then slid DOWN
    // by a main-thread translateY, so for a tall panel the layout-page frame
    // puts the composer near the page top (containerTop 10) — no room
    // "above", lots "below" → the popup flips down, and once the transform is
    // applied that lands it behind the keyboard. The measured VIEWPORT frame
    // has the composer where it actually is: docked above a 300dp keyboard.
    it('stays above the caret when the container is measured in viewport coords', () => {
        const composer = {
            ...base,
            containerHeight: 60,
            caretRect: { x: 12, y: 20, height: 18 },
            keyboardHeight: 300,
        };
        // Measured (viewport): composer sits just above the keyboard top (500).
        expect(placeSuggestionPopup({ ...composer, containerTop: 430 }).placement).toBe('above');
        // Layout-page frame (the bug): the untransformed box is near the top.
        expect(placeSuggestionPopup({ ...composer, containerTop: 10 }).placement).toBe('below');
    });

    it('honors an explicit placement instead of measuring for room', () => {
        // No room above at all (container at the very top), yet a host that
        // knows its layout can still pin the side.
        const cramped = { ...base, containerTop: 0, caretRect: { x: 30, y: 4, height: 18 } };
        expect(placeSuggestionPopup(cramped).placement).toBe('below');
        expect(placeSuggestionPopup({ ...cramped, prefer: 'above' }).placement).toBe('above');
        expect(placeSuggestionPopup({ ...base, prefer: 'below' }).placement).toBe('below');
        // 'auto' is the documented default and must match omitting it.
        expect(placeSuggestionPopup({ ...base, prefer: 'auto' })).toEqual(placeSuggestionPopup(base));
    });

    it('still clamps against the keyboard when the side is pinned', () => {
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 20, height: 18 },
            keyboardHeight: 770, // keyboard top at 30 — almost nothing below
            prefer: 'below',
        });
        expect(pos.placement).toBe('below');
        // Caret bottom (38) is already past the keyboard top (30) — nothing
        // fits, so the list collapses rather than painting under the keyboard.
        expect(pos.maxHeight).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Popup ↔ owner measurement contract
// ---------------------------------------------------------------------------

describe('SuggestionPopup measurement requests', () => {
    const frame = { width: 320, height: 48, top: 400, left: 0, right: 320, bottom: 448 };
    const caretRect = { x: 12, y: 6, height: 18 };
    const items: TriggerItem[] = [{ id: 'u1', label: 'Andy' }];

    it('asks the owner to re-measure on mount and again after the lift settles', async () => {
        vi.useFakeTimers();
        try {
            const onMeasureRequest = vi.fn();
            render(
                <SuggestionPopup
                    items={items}
                    caretRect={caretRect}
                    containerFrame={frame}
                    onMeasureRequest={onMeasureRequest}
                />,
            );
            // Mount: the popup only exists when a session has results, which
            // is exactly when the frame has to be current.
            expect(onMeasureRequest).toHaveBeenCalledTimes(1);
            // …and once more once the keyboard-lift tween can no longer be
            // mid-flight (the height signal lands at its START).
            vi.advanceTimersByTime(400);
            expect(onMeasureRequest).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders without an owner-supplied measure callback', () => {
        const { container } = render(
            <SuggestionPopup items={items} caretRect={caretRect} containerFrame={frame} />,
        );
        expect(container.findAllByType('view').some((v) => v.props['ignore-focus'] === true)).toBe(true);
    });

    it('honors an explicit placement prop', () => {
        const { container } = render(
            <SuggestionPopup
                items={items}
                caretRect={caretRect}
                // Container at the top of the screen: 'auto' would open below.
                containerFrame={{ ...frame, top: 0, bottom: 48 }}
                placement="above"
            />,
        );
        const popup = container.findAllByType('view').find((v) => v.props['ignore-focus'] === true)!;
        const style = popup.props.style as { top?: number; bottom?: number };
        expect(style.bottom).toBeDefined();
        expect(style.top).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Editor sessions
// ---------------------------------------------------------------------------

const USERS = [
    { id: 'u1', label: 'Andy' },
    { id: 'u2', label: 'Anna' },
    { id: 'u3', label: 'Bea' },
];
const search = (q: string) => USERS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase()));

beforeEach(installFakeElement);
afterEach(resetFakeElement);

type ViewNode = TestNode;
const popupOf = (container: { findAllByType: (t: string) => ViewNode[] }): ViewNode | null =>
    container.findAllByType('view').find((v) => v.props['ignore-focus'] === true && v.props['accessibility-label'] === undefined) ?? null;
/** The tappable row that renders `label`. */
const rowOf = (popup: ViewNode, label: string): ViewNode => popup.findAllByType('view').find((v) => v._handlers.has('bindtap') && v.findByText(label))!;

describe('MarkdownEditor trigger sessions', () => {
    it('opens the popup inside the block the session belongs to and picks with Enter', async () => {
        const onTriggerSession = vi.fn<(s: TriggerSession | null) => void>();
        const m = await mountEditor({ value: 'cc', plugins: [createMentionPlugin({ search })], onTriggerSession });
        const f = m.field(0);
        layoutFields(m.container);
        tapAt(f, 2);
        typeIn(f, ' @an');
        await waitForUpdate();
        expect(onTriggerSession).toHaveBeenLastCalledWith(expect.objectContaining({ plugin: 'mention', key: 'b-0', query: 'an', anchor: 3, caret: 6 }));
        const popup = popupOf(m.container);
        expect(popup).toBeTruthy();
        expect(m.container.findByText('Andy')).toBeTruthy();
        expect(m.container.findByText('Anna')).toBeTruthy();
        // ArrowDown moves the active row; Enter picks it — the field never sees either key.
        press(f, 'ArrowDown');
        press(f, 'Enter');
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('cc @[Anna](u2)\n');
        expect(onTriggerSession).toHaveBeenLastCalledWith(null);
        expect(popupOf(m.container)).toBeNull();
    });

    it('a tap on a row picks it and Escape closes the session', async () => {
        const m = await mountEditor({ value: '', plugins: [createMentionPlugin({ search })] });
        const f = m.field(0);
        layoutFields(m.container);
        tapAt(f, 0);
        typeIn(f, '@b');
        await waitForUpdate();
        fireEvent.tap(rowOf(popupOf(m.container)!, 'Bea'));
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('@[Bea](u3)\n');
        typeIn(f, '@a');
        await waitForUpdate();
        expect(popupOf(m.container)).toBeTruthy();
        press(f, 'Escape');
        await waitForUpdate();
        expect(popupOf(m.container)).toBeNull();
    });

    it('suggestions="none" with renderSuggestions docks the list where the host puts it (#755)', async () => {
        const seen: string[] = [];
        const m = await mountEditor({
            value: '',
            plugins: [createMentionPlugin({ search })],
            suggestions: 'none',
            renderSuggestions: (api) => {
                seen.push(api.session.query);
                return (
                    <view accessibility-label="docked">
                        {api.session.items.map((item: TriggerItem) => (
                            <text key={item.id} bindtap={() => api.pick(item)}>{`docked:${item.label}`}</text>
                        ))}
                    </view>
                );
            },
        });
        const f = m.field(0);
        tapAt(f, 0);
        typeIn(f, '@an');
        await waitForUpdate();
        expect(seen).toContain('an');
        expect(popupOf(m.container)).toBeNull();
        const docked = m.container.findAllByType('view').find((v) => v.props['accessibility-label'] === 'docked')!;
        fireEvent.tap(docked.findAllByType('text').find((t) => t._handlers.has('bindtap') && t.findByText('docked:Andy'))!);
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('@[Andy](u1)\n');
    });

    it('forwards suggestionPopup styling to the popup container', async () => {
        const m = await mountEditor({ value: '', plugins: [createMentionPlugin({ search })], suggestionPopup: { surfaceColor: '#123456', width: 300 } });
        const f = m.field(0);
        layoutFields(m.container);
        tapAt(f, 0);
        typeIn(f, '@a');
        await waitForUpdate();
        const popup = popupOf(m.container)!;
        const style = popup.props['style'] as Record<string, unknown>;
        expect(style.backgroundColor).toBe('#123456');
        expect(style.width).toBe(300);
    });

    it('plugin toolbar items append after the defaults', async () => {
        const run = vi.fn();
        const plugin = { name: 'extra', editor: { toolbar: [{ id: 'extra', label: 'X', isEnabled: () => true, run }] } };
        const m = await mountEditor({ value: 'a', plugins: [plugin], toolbar: true });
        const item = m.container.findAllByType('view').find((v) => v._handlers.has('bindtap') && v.findByText('X'))!;
        fireEvent.tap(item);
        expect(run).toHaveBeenCalled();
        expect(m.container.findByText('B')).toBeTruthy();
    });
});
