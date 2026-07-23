/**
 * The full drag-ownership decision table. This function is the arbitration
 * core both sheet frontends run inside their pan worklets — these tests
 * are the behavioral contract that used to be pinned only by source shape
 * in lynx-navigation's sheet-drag-controller tests.
 */
import { describe, expect, it } from 'vitest';
import {
    decideDragOwner,
    GRABBER_HEIGHT,
    OWNER_CONTENT,
    OWNER_SHEET,
    OWNER_UNDECIDED,
    type DragOwnerInput,
} from '../src/math';

/**
 * Baseline: 800px screen, sheet at its 720px max detent, adopted inner
 * scrollable scrolled 50px down, finger mid-body dragging down.
 */
function input(overrides: Partial<DragOwnerInput> = {}): DragOwnerInput {
    return {
        dx: 0,
        dy: 10,
        frameDown: 1,
        startPageY: 400,
        combinedPx: 720,
        maxPx: 720,
        bottomEdgePageY: 800,
        grabberPx: GRABBER_HEIGHT,
        grabberOnly: 0,
        hasScroll: 1,
        scrollOffsetY: 50,
        currentOwner: OWNER_UNDECIDED,
        ...overrides,
    };
}

describe('decideDragOwner — first-frame arbitration', () => {
    it('stays undecided while the finger has not moved', () => {
        expect(decideDragOwner(input({ dx: 0, dy: 0 }))).toBe(OWNER_UNDECIDED);
    });

    it('step 1: a touch in the grabber chrome zone always drags the sheet', () => {
        // Sheet top = 800 - 720 = 80; touches within GRABBER_HEIGHT below it claim.
        expect(decideDragOwner(input({ startPageY: 80 + GRABBER_HEIGHT - 1 }))).toBe(OWNER_SHEET);
        // Even a mostly-horizontal drag — the chrome check precedes the axis gate.
        expect(
            decideDragOwner(input({ startPageY: 85, dx: 30, dy: 5 })),
        ).toBe(OWNER_SHEET);
        // And even in grabber-only mode — that is the mode's whole point.
        expect(
            decideDragOwner(input({ startPageY: 85, grabberOnly: 1 })),
        ).toBe(OWNER_SHEET);
    });

    it('step 1: grabberPx 0 disables the chrome zone', () => {
        expect(
            decideDragOwner(input({ startPageY: 80, grabberPx: 0, dy: -10, frameDown: 0 })),
        ).toBe(OWNER_CONTENT); // falls through to the at-max-up rule
    });

    it('step 2: a mostly-horizontal drag belongs to content (web axis gate)', () => {
        expect(decideDragOwner(input({ dx: 30, dy: 10 }))).toBe(OWNER_CONTENT);
    });

    it('step 3: grabber-only mode never lets the body drag', () => {
        expect(decideDragOwner(input({ grabberOnly: 1 }))).toBe(OWNER_CONTENT);
        // Regardless of scroll state or position (startPageY stays in the
        // body — a half-open sheet's grabber zone moves down with its top).
        expect(
            decideDragOwner(input({ grabberOnly: 1, hasScroll: 0, combinedPx: 400, startPageY: 600 })),
        ).toBe(OWNER_CONTENT);
    });

    it('step 4: a plain-content sheet (no scrollable) always drags', () => {
        expect(decideDragOwner(input({ hasScroll: 0 }))).toBe(OWNER_SHEET);
        expect(decideDragOwner(input({ hasScroll: 0, dy: -10, frameDown: 0 }))).toBe(OWNER_SHEET);
    });

    it('step 5: below the max detent the sheet drags (content is rest-locked)', () => {
        // startPageY 600 keeps the touch in the body (sheet top is at 400).
        expect(decideDragOwner(input({ combinedPx: 400, startPageY: 600 }))).toBe(OWNER_SHEET);
        expect(
            decideDragOwner(input({ combinedPx: 400, startPageY: 600, dy: -10, frameDown: 0 })),
        ).toBe(OWNER_SHEET);
    });

    it('step 6: at max, dragging up scrolls content', () => {
        expect(decideDragOwner(input({ dy: -10, frameDown: 0 }))).toBe(OWNER_CONTENT);
    });

    it('step 7: at max, dragging down with content at top drags the sheet', () => {
        expect(decideDragOwner(input({ scrollOffsetY: 0 }))).toBe(OWNER_SHEET);
        // ≤ covers iOS bounce-negative offsets.
        expect(decideDragOwner(input({ scrollOffsetY: -8 }))).toBe(OWNER_SHEET);
    });

    it('step 8: at max, dragging down with content scrolled belongs to content', () => {
        expect(decideDragOwner(input({ scrollOffsetY: 50 }))).toBe(OWNER_CONTENT);
    });
});

describe('decideDragOwner — sticky ownership and handoff', () => {
    it('a SHEET decision is final for the gesture', () => {
        expect(
            decideDragOwner(input({ currentOwner: OWNER_SHEET, dy: -30, scrollOffsetY: 100 })),
        ).toBe(OWNER_SHEET);
    });

    it('hands off CONTENT → SHEET when content reaches top still moving down', () => {
        expect(
            decideDragOwner(input({ currentOwner: OWNER_CONTENT, scrollOffsetY: 0 })),
        ).toBe(OWNER_SHEET);
        expect(
            decideDragOwner(input({ currentOwner: OWNER_CONTENT, scrollOffsetY: -4 })),
        ).toBe(OWNER_SHEET);
    });

    it('never hands off while any conjunct fails', () => {
        // Still scrolled down.
        expect(
            decideDragOwner(input({ currentOwner: OWNER_CONTENT, scrollOffsetY: 10 })),
        ).toBe(OWNER_CONTENT);
        // Moving up.
        expect(
            decideDragOwner(input({ currentOwner: OWNER_CONTENT, scrollOffsetY: 0, frameDown: 0 })),
        ).toBe(OWNER_CONTENT);
        // Sheet no longer at max (mid-transition).
        expect(
            decideDragOwner(
                input({ currentOwner: OWNER_CONTENT, scrollOffsetY: 0, combinedPx: 700 }),
            ),
        ).toBe(OWNER_CONTENT);
        // No scrollable adopted (parked as CONTENT by the axis gate).
        expect(
            decideDragOwner(
                input({ currentOwner: OWNER_CONTENT, scrollOffsetY: 0, hasScroll: 0 }),
            ),
        ).toBe(OWNER_CONTENT);
    });

    it('grabber-only mode blocks the handoff (body must never drag)', () => {
        expect(
            decideDragOwner(
                input({ currentOwner: OWNER_CONTENT, scrollOffsetY: 0, grabberOnly: 1 }),
            ),
        ).toBe(OWNER_CONTENT);
    });
});
