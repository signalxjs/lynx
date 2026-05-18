/**
 * Public JS API for the main-thread (MT) gesture/worklet test harness.
 *
 * Pair with `@sigx/lynx-testing/mt/setup` in your vitest setupFiles. See
 * the package README for a full example.
 *
 * The harness lets you write tests that:
 *   1. Compile a `.tsx` source file with `transformReactLynxSync`
 *      (target: `LEPUS`) to extract the `registerWorkletInternal(...)`
 *      calls the SWC transform emits for `'main thread'` worklets.
 *   2. Eval those registrations into the upstream worklet runtime that
 *      `setup.ts` boots, populating `lynxWorkletImpl._workletMap`.
 *   3. Call each worklet directly with a fabricated `_c` capture and a
 *      synthetic gesture event, asserting the worklet's MT-side state
 *      mutations and any `setStyleProperties` / `runOnBackground` calls.
 *
 * Use `compileMTWorklets()` for the common case (one source file, get
 * the registered worklets back). Drop down to `extractRegistrations()`
 * if you need finer control.
 */

import { transformReactLynxSync } from '@lynx-js/react/transform';
import { _getJsContext, _resetJsContextSpy } from './setup';

/**
 * Synthetic `MainThreadRef` shape — `{ current, _wvid }`. Worklets read
 * `ref.current.value` and may mutate `ref.current.value`.
 */
export function makeRef<T>(current: T, id = 1): { current: T; _wvid: number } {
    return { current, _wvid: id };
}

/**
 * Fabricate a Lynx pan-gesture event payload as the iOS arena would
 * deliver it. The payload is nested under `e.params` (NOT top-level on
 * `e`) — your worklet should read pageX/pageY from `e.params.pageX`,
 * mirroring real device behaviour.
 *
 * Verified against `LynxBaseGestureHandler.m::eventParamsFromTouchEvent`
 * + `LynxPanGestureHandler.m::eventParamsInActive` on iOS Lynx 3.5.
 */
export function fabricatePanEvent(opts: { pageX: number; pageY?: number }): MTGestureEvent {
    const params = {
        timestamp: Date.now(),
        type: 'touchmove',
        x: opts.pageX,
        y: opts.pageY ?? 0,
        pageX: opts.pageX,
        pageY: opts.pageY ?? 0,
        clientX: opts.pageX,
        clientY: opts.pageY ?? 0,
        scrollX: 0,
        scrollY: 0,
        isAtStart: 0,
        isAtEnd: 0,
    };
    return {
        type: 'onUpdate',
        timestamp: Date.now(),
        currentTarget: { element: null },
        target: { element: null },
        params,
        detail: params,
    };
}

/**
 * Fabricate a Lynx tap-gesture event payload. Same shape as the pan event
 * minus the scroll-related fields the pan handler adds; tests rarely read
 * either, so the difference is mostly cosmetic.
 */
export function fabricateTapEvent(opts: { pageX?: number; pageY?: number } = {}): MTGestureEvent {
    const params = {
        timestamp: Date.now(),
        type: 'touchend',
        x: opts.pageX ?? 0,
        y: opts.pageY ?? 0,
        pageX: opts.pageX ?? 0,
        pageY: opts.pageY ?? 0,
        clientX: opts.pageX ?? 0,
        clientY: opts.pageY ?? 0,
    };
    return {
        type: 'onStart',
        timestamp: Date.now(),
        currentTarget: { element: null },
        target: { element: null },
        params,
        detail: params,
    };
}

/**
 * Common shape for the events the iOS gesture arena delivers to MT
 * worklets. Top-level keys are dispatch metadata; the actual touch data
 * lives under `params` (and a duplicate `detail`).
 */
export interface MTGestureEvent {
    type: string;
    timestamp: number;
    currentTarget: { element: null };
    target: { element: null };
    params: Record<string, unknown>;
    detail: Record<string, unknown>;
}

/**
 * Extract `registerWorkletInternal(...)` calls from a LEPUS-target
 * transform output. Bracket-depth counting handles nested braces in the
 * function body. Mirror of the lynx-plugin internal so tests don't pull
 * a build-time package in as a runtime dep.
 */
export function extractRegistrations(lepusCode: string): string {
    const out: string[] = [];
    const marker = 'registerWorkletInternal(';
    let from = 0;

    while (true) {
        const idx = lepusCode.indexOf(marker, from);
        if (idx === -1) break;

        let depth = 0;
        let i = idx + marker.length - 1;
        for (; i < lepusCode.length; i++) {
            const ch = lepusCode[i];
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) break;
            }
        }

        let end = i + 1;
        if (end < lepusCode.length && lepusCode[end] === ';') end++;
        out.push(lepusCode.slice(idx, end));
        from = end;
    }

    return out.join('\n');
}

/**
 * Get the live `lynxWorkletImpl._workletMap` populated by the upstream
 * worklet runtime that `mt/setup.ts` bootstrapped. Each entry is a
 * `_wkltId` → callable mapping. After `compileMTWorklets()` evals new
 * registrations, this map will include them.
 *
 * Throws if `mt/setup.ts` didn't run — typically because the consumer
 * forgot to add it to `setupFiles`.
 */
export function getWorkletMap(): Record<string, Function> {
    interface WorkletImpl {
        _workletMap: Record<string, Function>;
    }
    const impl = (globalThis as { lynxWorkletImpl?: WorkletImpl }).lynxWorkletImpl;
    if (!impl) {
        throw new Error(
            '[lynx-testing/mt] lynxWorkletImpl is not initialized — add ' +
            '`@sigx/lynx-testing/mt/setup` to your vitest config\'s ' +
            '`setupFiles` array.'
        );
    }
    return impl._workletMap;
}

/**
 * Compile a `.tsx` source file as a LEPUS worklet bundle, eval the
 * resulting `registerWorkletInternal(...)` calls into the live runtime,
 * and return the worklets that were just registered (in source order).
 *
 * The returned array indexes into `lynxWorkletImpl._workletMap`'s newest
 * entries — i.e. `result[0]` is the first worklet registered by this
 * compile. For most tests this is enough; for cross-test sharing or
 * per-`_wkltId` access, fall back to `getWorkletMap()`.
 *
 * @example
 * ```ts
 * import { readFileSync } from 'fs';
 * import { compileMTWorklets, fabricatePanEvent, makeRef } from '@sigx/lynx-testing/mt';
 *
 * const SRC = path.resolve(__dirname, '../../src/components/Draggable.tsx');
 * const worklets = compileMTWorklets({
 *     filename: SRC,
 *     source: readFileSync(SRC, 'utf8'),
 * });
 * // Source-order: onBegin (:1), onStart (:2), onUpdate (:3), onEnd (:4)
 * const onUpdate = worklets[2]!;
 *
 * const drag = { startPageX: 100, startPageY: 50, ... };
 * onUpdate.call({ _c: { drag: makeRef(drag, 1), ... } }, fabricatePanEvent({ pageX: 130, pageY: 55 }));
 * expect(drag.startPageX).toBe(100);
 * ```
 */
export function compileMTWorklets(opts: {
    filename: string;
    source: string;
    /**
     * Override the runtime package name passed to the SWC transform.
     * Defaults to `@sigx/lynx-runtime-main`, which matches what the
     * production build uses.
     */
    runtimePkg?: string;
}): Function[] {
    const { filename, source, runtimePkg = '@sigx/lynx-runtime-main' } = opts;

    const result = transformReactLynxSync(source, {
        pluginName: 'sigx:test',
        filename,
        sourcemap: false,
        cssScope: false,
        shake: false,
        compat: false,
        refresh: false,
        defineDCE: false,
        directiveDCE: false,
        snapshot: false,
        worklet: { target: 'LEPUS', filename, runtimePkg },
    });

    if (result.errors && result.errors.length > 0) {
        throw new Error(
            '[lynx-testing/mt] LEPUS transform errors for ' + filename + ':\n' +
            result.errors.map((e) => '  - ' + (e.text ?? '<unknown>')).join('\n')
        );
    }

    // Eval the registrations against `globalThis.registerWorkletInternal`
    // (installed by `setup.ts`). SWC produces deterministic `_wkltId`s
    // from the source content hash + index, so re-compiling the same
    // source overwrites the same map entries — we can't diff by
    // map-presence to find what this call registered. Instead parse the
    // IDs directly out of the registration source.
    const registrations = extractRegistrations(result.code);
    new Function(registrations)();

    // Each registration looks like:
    //   registerWorkletInternal("main-thread", "<wkltId>", function(...) {...});
    // Extract the wkltId from the second string literal in source order.
    const idRegex = /registerWorkletInternal\(\s*"main-thread"\s*,\s*"([^"]+)"/g;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = idRegex.exec(registrations)) !== null) {
        ids.push(m[1]!);
    }

    const map = getWorkletMap();
    return ids.map(id => {
        const fn = map[id];
        if (!fn) {
            throw new Error(
                '[lynx-testing/mt] worklet `' + id + '` was registered by the ' +
                'compile but is missing from lynxWorkletImpl._workletMap. The ' +
                'upstream worklet runtime may not have evaluated correctly.'
            );
        }
        return fn;
    });
}

/**
 * Read the JS-context spy that `mt/setup.ts` installed on the lynx mock.
 * Useful for asserting `runOnBackground` / `Lynx.Sigx.AvPublish` event
 * dispatches from within a worklet.
 *
 * @example
 * ```ts
 * import { getJsContext } from '@sigx/lynx-testing/mt';
 *
 * onUpdate.call(ctx, fabricatePanEvent({ pageX: 130 }));
 * const ctx = getJsContext();
 * expect(ctx.dispatchEvent).toHaveBeenCalledWith(
 *     expect.objectContaining({ type: 'Lynx.Sigx.AvPublish' })
 * );
 * ```
 */
export function getJsContext(): { addEventListener: Function; dispatchEvent: Function } {
    return _getJsContext();
}

/**
 * Wipe the JS-context spy between tests so dispatchEvent / addEventListener
 * call counts don't bleed across cases.
 */
export function resetJsContextSpy(): void {
    _resetJsContextSpy();
}
