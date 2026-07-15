/**
 * #620 SPIKE — hand-written main-thread snapshot template for the emoji cell.
 * THROWAWAY: this file exists only on the 620-spike-snapshot branch, never for
 * merge. It answers one question: what does one cell cost when the MT builds
 * it synchronously via direct PAPI calls, versus ~1.3ms/cell via the
 * BG-op-stream path?
 *
 * Wire-in points (both marked "#620 spike"):
 *  - ops-apply.ts SET_PROP intercepts the `spike-snapshot-rows` marker attr on
 *    a <list> and routes it here instead of native.
 *  - list-mt.ts componentAtIndex consults spikePull() before its normal
 *    prebuilt-sign path.
 *
 * Reporting: MT has no logcat-visible console, so results ship to the BG via
 * the existing `Lynx.Sigx.PublishEvent` bridge (same mechanism as
 * hybrid-worklet.ts), addressed to a BG event-registry sign the showcase
 * screen registers and passes inside the marker payload.
 */

import { pageUniqueId } from './element-registry.js';

export interface SpikeRowsPayload {
  glyphs: string[];
  reportSign: string;
  /**
   * Cell shape variant:
   *  - 'full': view + inline styles + a11y attrs + __AddEvent + text +
   *    raw-text child (mirrors EmojiCell's rendered Pressable shape, in the
   *    shape a compiled ReactLynx-style template would emit).
   *  - 'bare': view + text + raw-text only.
   *  - 'styled': bare + the two __SetInlineStyles calls (no a11y, no event).
   *  - 'a11y': bare + a11y attrs + __AddEvent (no inline styles).
   *  - 'classy': bare + __SetClasses on view and text (CSS-class styling).
   *  - 'sigxtext': like 'full' but the glyph is a nested __CreateText with a
   *    `text` attribute (today's sigx text shape) in case raw-text does not
   *    paint on some host.
   */
  variant: 'full' | 'bare' | 'styled' | 'a11y' | 'classy' | 'sigxtext' | 'sweep';
  /** Warm-loop sizes to run on arrival (cells built detached, then dropped). */
  warmLoops?: number[];
}

interface SpikeState {
  payload: SpikeRowsPayload;
  /** cellIndex → built cell root, so scroll-back re-pulls resolve. */
  built: Map<number, MainThreadElement>;
  pulls: number;
  buildMs: number;
  maxBuildMs: number;
  /** pulls resolved from `built` without constructing (scroll-back). */
  rePulls: number;
  /**
   * Burst tracking: wall time from the first to the last pull of a burst
   * (pulls separated by <500ms). This includes native's between-pull overhead,
   * which is exactly the "does a fling burst fit the frame budget" question.
   */
  burstStart: number;
  burstLast: number;
  burstPulls: number;
}

/**
 * Lepus may or may not expose performance.now (sub-ms). Probe once; the
 * papi-probe report says which clock the numbers are on.
 */
const perf = (globalThis as { performance?: { now?: () => number } }).performance;
const hasPerfNow = typeof perf?.now === 'function';
const now: () => number = hasPerfNow ? () => perf!.now!() : () => Date.now();

/** list internalId → spike state */
const spikeByList = new Map<number, SpikeState>();

// ---------------------------------------------------------------------------
// Reporting (MT → BG via the PublishEvent bridge)
// ---------------------------------------------------------------------------

interface JSContextLike {
  dispatchEvent?: (e: { type: string; data: string }) => void;
}
interface LynxLike {
  getJSContext?: () => JSContextLike;
}

function report(sign: string, event: unknown): void {
  const lynxObj = (globalThis as { lynx?: LynxLike }).lynx;
  const ctx = lynxObj?.getJSContext?.();
  if (!ctx?.dispatchEvent) return;
  try {
    ctx.dispatchEvent({
      type: 'Lynx.Sigx.PublishEvent',
      data: JSON.stringify({ sign, event }),
    });
  } catch {
    // spike-only: drop unserializable payloads
  }
}

// ---------------------------------------------------------------------------
// The hand-written template ("create()" of a would-be compiled snapshot)
// ---------------------------------------------------------------------------

const CELL_STYLES = {
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  'padding-top': '6px',
  'padding-bottom': '6px',
} as const;

const TEXT_STYLES = { 'font-size': '26px' } as const;

function buildCell(
  glyph: string,
  variant: SpikeRowsPayload['variant'],
  itemKey: string,
): MainThreadElement {
  if (variant === 'sweep') variant = 'full'; // sweep pulls render as 'full'
  // Native list cells must root at a <list-item> element (ReactLynx's
  // compiled list-item snapshots root at __CreateElement("list-item", ...)).
  const item = __CreateElement('list-item', pageUniqueId);
  __SetCSSId([item], 0);
  __SetAttribute(item, 'item-key', itemKey);
  const view = __CreateView(pageUniqueId);
  __SetCSSId([view], 0);
  const wantStyles = variant === 'full' || variant === 'styled' || variant === 'sigxtext';
  const wantA11y = variant === 'full' || variant === 'a11y' || variant === 'sigxtext';
  if (wantStyles) __SetInlineStyles(view, CELL_STYLES);
  if (variant === 'classy') __SetClasses(view, 'flex items-center justify-center py-1');
  if (wantA11y) {
    __SetAttribute(view, 'accessibility-element', true);
    __SetAttribute(view, 'accessibility-label', glyph);
    __SetAttribute(view, 'accessibility-trait', 'button');
    // Approximate the Pressable's event attachment cost. The sign is inert —
    // BG's publishEvent drops unknown signs.
    __AddEvent(view, 'bindEvent', 'tap', 'spike:noop');
  }
  const text = __CreateText(pageUniqueId);
  __SetCSSId([text], 0);
  if (wantStyles) __SetInlineStyles(text, TEXT_STYLES);
  if (variant === 'classy') __SetClasses(text, 'text-2xl');
  if (variant === 'sigxtext') {
    const inner = __CreateText(pageUniqueId);
    __SetCSSId([inner], 0);
    __SetAttribute(inner, 'text', glyph);
    __AppendElement(text, inner);
  } else {
    const raw = __CreateRawText(glyph);
    __AppendElement(text, raw);
  }
  __AppendElement(view, text);
  __AppendElement(item, view);
  return item;
}

// ---------------------------------------------------------------------------
// Wire-in API (called from list-mt.ts / ops-apply.ts)
// ---------------------------------------------------------------------------

/**
 * Intercept the `spike-snapshot-rows` marker attr. Returns the parsed payload
 * (so list-mt can synthesize update-list-info) or null when the value is not
 * a spike payload.
 */
export function noteSpikeRows(
  listInternalId: number,
  value: unknown,
): SpikeRowsPayload | null {
  const payload = value as SpikeRowsPayload | null;
  if (
    !payload || typeof payload !== 'object'
    || !Array.isArray(payload.glyphs)
    || typeof payload.reportSign !== 'string'
  ) return null;
  spikeByList.set(listInternalId, {
    payload,
    built: new Map(),
    pulls: 0,
    buildMs: 0,
    maxBuildMs: 0,
    rePulls: 0,
    burstStart: 0,
    burstLast: 0,
    burstPulls: 0,
  });

  // PAPI availability probe — #620 needs these two for slot stitching.
  report(payload.reportSign, {
    kind: 'papi-probe',
    createWrapperElement: typeof (globalThis as Record<string, unknown>).__CreateWrapperElement,
    replaceElement: typeof (globalThis as Record<string, unknown>).__ReplaceElement,
    firstElement: typeof (globalThis as Record<string, unknown>).__FirstElement,
    updateRawText: typeof (globalThis as Record<string, unknown>).__UpdateRawText,
    clock: hasPerfNow ? 'performance.now' : 'Date.now',
    variant: payload.variant,
    rows: payload.glyphs.length,
  });

  const variants: SpikeRowsPayload['variant'][] = payload.variant === 'sweep'
    ? ['bare', 'styled', 'a11y', 'classy', 'full', 'sigxtext']
    : [payload.variant];

  for (const variant of variants) {
    // Warm loops: pure construction cost, detached cells, one MT turn each.
    for (const n of payload.warmLoops ?? [500, 500, 1900]) {
      const t0 = now();
      for (let i = 0; i < n; i++) {
        buildCell(payload.glyphs[i % payload.glyphs.length], variant, `warm-${i}`);
      }
      const total = now() - t0;
      report(payload.reportSign, {
        kind: 'warm-loop',
        variant,
        cells: n,
        totalMs: total,
        msPerCell: total / n,
      });
    }

    // Recycle bound: re-PATCHING an existing cell (what enqueueComponent →
    // componentAtIndex reuse would do) instead of constructing one. Three
    // __SetAttribute-class calls per cell vs ~12 creation calls.
    if ((payload.warmLoops ?? [1]).length > 0) {
      try {
        const pool: MainThreadElement[] = [];
        for (let i = 0; i < 500; i++) {
          pool.push(buildCell(payload.glyphs[i % payload.glyphs.length], variant, `pool-${i}`));
        }
        for (let round = 0; round < 2; round++) {
          const t0 = now();
          for (let i = 0; i < pool.length; i++) {
            const item = pool[i];
            const glyph = payload.glyphs[(i + round + 7) % payload.glyphs.length];
            // item → view → text → raw/inner-text
            const view = __FirstElement(item);
            const text = view ? __FirstElement(view) : null;
            const raw = text ? __FirstElement(text) : null;
            __SetAttribute(item, 'item-key', `re-${round}-${i}`);
            if (view) __SetAttribute(view, 'accessibility-label', glyph);
            // Raw-text and sigx-text nodes both update via the 'text' attribute
            // (__UpdateRawText does not exist on this host — verified by probe).
            if (raw) __SetAttribute(raw, 'text', glyph);
          }
          const total = now() - t0;
          report(payload.reportSign, {
            kind: 'repatch-loop',
            variant,
            cells: pool.length,
            totalMs: total,
            msPerCell: total / pool.length,
          });
        }
      } catch (e) {
        report(payload.reportSign, { kind: 'repatch-error', error: String(e) });
      }
    }
  }
  return payload;
}

/** True when this list is spike-managed. */
export function isSpikeList(listInternalId: number): boolean {
  return spikeByList.has(listInternalId);
}

/**
 * `spike-op-echo` marker attr: the moment this op is applied on the MT, echo
 * back to the BG over the report bridge. Rides at the tail of an op batch to
 * timestamp "batch fully applied" without relying on the callLepusMethod ack.
 */
export function spikeOpEcho(value: unknown): void {
  const v = value as { sign?: string; tag?: unknown } | null;
  if (!v || typeof v.sign !== 'string') return;
  report(v.sign, { kind: 'op-echo', tag: v.tag });
}

/**
 * Synchronous cell construction for a spike list. Returns the cell root
 * (building it on first pull), or null when out of range / not a spike list.
 * The caller (list-mt componentAtIndex) appends + flushes + returns the sign,
 * mirroring its normal path.
 */
export function spikePull(
  listInternalId: number,
  cellIndex: number,
): MainThreadElement | null {
  const state = spikeByList.get(listInternalId);
  if (!state) return null;
  const existing = state.built.get(cellIndex);
  if (existing) {
    state.rePulls++;
    return existing;
  }
  const glyph = state.payload.glyphs[cellIndex];
  if (glyph === undefined) return null;

  const t0 = now();
  const cell = buildCell(glyph, state.payload.variant, `spike-${cellIndex}`);
  const t1 = now();
  const dt = t1 - t0;

  // Burst accounting: a gap >500ms starts a new burst.
  if (state.burstPulls === 0 || t0 - state.burstLast > 500) {
    state.burstStart = t0;
    state.burstPulls = 0;
  }
  state.burstLast = t1;
  state.burstPulls++;

  state.built.set(cellIndex, cell);
  state.pulls++;
  state.buildMs += dt;
  if (dt > state.maxBuildMs) state.maxBuildMs = dt;
  if (state.pulls % 50 === 0) reportPulls(state);
  return cell;
}

function reportPulls(state: SpikeState): void {
  const burstMs = state.burstLast - state.burstStart;
  report(state.payload.reportSign, {
    kind: 'pulls',
    variant: state.payload.variant,
    pulls: state.pulls,
    rePulls: state.rePulls,
    totalBuildMs: state.buildMs,
    msPerCell: state.pulls > 0 ? state.buildMs / state.pulls : 0,
    maxBuildMs: state.maxBuildMs,
    burstPulls: state.burstPulls,
    burstWallMs: burstMs,
    burstWallMsPerCell: state.burstPulls > 0 ? burstMs / state.burstPulls : 0,
  });
}

/** Drop spike state when its list is destroyed; emit a final report. */
export function destroySpikeList(listInternalId: number): void {
  const state = spikeByList.get(listInternalId);
  if (!state) return;
  if (state.pulls > 0) reportPulls(state);
  spikeByList.delete(listInternalId);
}
