/**
 * Tests for the worklet loaders (BG + MT).
 *
 * Both loaders delegate to @lynx-js/react/transform; we verify they invoke
 * it correctly and that the contract sigx-lynx's runtime depends on holds:
 *   - BG output: { _wkltId, _c? } placeholder at the JSX prop position
 *   - MT output: registerWorkletInternal("main-thread", "<id>", function(...) {...})
 *
 * `_wkltId` values are non-deterministic across the test run so assertions
 * use regex / contains checks rather than equality on the full string.
 */

import { describe, it, expect } from 'vitest';
import workletLoader from '../src/loaders/worklet-loader';
import workletLoaderMT from '../src/loaders/worklet-loader-mt';

function createCtx(resourcePath: string) {
  return {
    resourcePath,
    cacheable: () => {},
    emitError: (e: Error) => { throw e; },
  } as any;
}

function bg(source: string, resourcePath = '/app/src/component.tsx'): string {
  return workletLoader.call(createCtx(resourcePath), source);
}

function mt(source: string, resourcePath = '/app/src/component.tsx'): string {
  return workletLoaderMT.call(createCtx(resourcePath), source);
}

describe('worklet-loader (BG)', () => {
  it('passes through files without the directive unchanged', () => {
    const source = `export const x = 1;`;
    expect(bg(source)).toBe(source);
  });

  it('does NOT trip on "main thread" appearing inside a string literal', () => {
    // `@sigx/lynx-runtime/dist/index.js` ships a runOnBackground error that
    // mentions the directive verbatim:
    //   throw Error("... inside 'main thread' functions. ...")
    // A loose substring check would treat this as a worklet file and the
    // upstream transform would mangle the module's exports.
    const source = `
      export function runOnBackground() {
        throw Error("runOnBackground() can only be used inside 'main thread' functions.");
      }
      export const helper = () => 1;
    `;
    expect(bg(source)).toBe(source);
  });

  it('recognizes ASI-style directives without an explicit semicolon', () => {
    // The pre-filter must accept `'main thread'\n` (newline as statement
    // terminator via ASI) — otherwise the BG transform never runs and the
    // worklet body ends up shipped to BG verbatim instead of replaced with
    // a `{ _wkltId }` placeholder.
    const source = `
      export function MyComp() {
        return _jsx('view', {
          'main-thread-bindtap': () => {
            'main thread'
            console.log('tap')
          },
        });
      }
    `;
    const out = bg(source);
    expect(out).toMatch(/_wkltId:\s*"[^"]+"/);
  });

  it('emits a { _wkltId, _c } placeholder for a handler that captures a ref', () => {
    const source = `
      import { useMainThreadRef } from '@sigx/lynx-runtime-main';
      export function MyComp() {
        const headerRef = useMainThreadRef(null);
        return _jsx('view', {
          'main-thread-bindscroll': (e) => {
            'main thread';
            headerRef.current?.setStyleProperties({ opacity: '0.5' });
          },
        });
      }
    `;
    const out = bg(source);
    expect(out).toMatch(/_wkltId:\s*"[^"]+"/);
    expect(out).toMatch(/_c:\s*\{\s*headerRef\s*\}/);
    // The arrow body is removed from the BG bundle — no setStyleProperties call here.
    expect(out).not.toContain('setStyleProperties');
  });

  it('emits a { _wkltId, _c } placeholder for a captured literal', () => {
    const source = `
      const ITEM_HEIGHT = 80;
      export function MyComp() {
        return _jsx('view', {
          'main-thread-bindtap': () => {
            'main thread';
            console.log(ITEM_HEIGHT);
          },
        });
      }
    `;
    const out = bg(source);
    expect(out).toMatch(/_c:\s*\{\s*ITEM_HEIGHT\s*\}/);
  });

  it('omits _c when the worklet has no captures', () => {
    const source = `
      export function MyComp() {
        return _jsx('view', {
          'main-thread-bindtap': () => {
            'main thread';
            console.log('tapped');
          },
        });
      }
    `;
    const out = bg(source);
    expect(out).toMatch(/_wkltId:\s*"[^"]+"/);
    // No _c when nothing is captured.
    expect(out).not.toMatch(/_c:\s*\{/);
  });
});

describe('worklet-loader-mt (MT)', () => {
  it('emits only the bootstrap preamble for files with no imports and no directive', () => {
    const source = `export const x = 1;`;
    const out = mt(source);
    // The MT loader prepends three side-effect imports to every file so the
    // worklet-runtime + hybrid-worklet bootstrap evaluates before user code:
    expect(out).toContain('entry-main.js');
    expect(out).toContain('worklet-runtime');
    expect(out).toContain('install-hybrid-worklet.js');
    // No user code, no registrations.
    expect(out).not.toContain('registerWorkletInternal');
    expect(out).not.toContain('export const x');
  });

  it('preserves relative + @sigx/* imports as side-effect imports', () => {
    const source = `
      import App from './App';
      import { foo } from './utils';
      import { signal } from '@sigx/lynx';
      import { Pressable, Draggable } from '@sigx/gestures';
      import * as React from 'react';
      export const x = 1;
    `;
    const out = mt(source);
    expect(out).toContain(`import './App';`);
    expect(out).toContain(`import './utils';`);
    // @sigx/* packages may ship MT components — preserve so rspack walks them
    // and their registerWorkletInternal calls land in the MT bundle.
    expect(out).toContain(`import '@sigx/lynx';`);
    expect(out).toContain(`import '@sigx/gestures';`);
    // Non-@sigx packages stay dropped.
    expect(out).not.toContain(`import 'react';`);
  });

  it('emits a registerWorkletInternal call for each worklet', () => {
    const source = `
      import { useMainThreadRef } from '@sigx/lynx-runtime-main';
      export function MyComp() {
        const headerRef = useMainThreadRef(null);
        return _jsx('view', {
          'main-thread-bindscroll': (e) => {
            'main thread';
            headerRef.current?.setStyleProperties({ opacity: '0.5' });
          },
          'main-thread-bindtap': () => {
            'main thread';
            console.log('tap');
          },
        });
      }
    `;
    const out = mt(source);
    const matches = out.match(/registerWorkletInternal\(\s*"main-thread"/g) ?? [];
    expect(matches.length).toBe(2);
    // The original handler bodies are preserved inside the registration.
    expect(out).toContain('setStyleProperties');
    expect(out).toContain(`console.log('tap')`);
    // The MT loader strips out user component code.
    expect(out).not.toContain('export function MyComp');
    expect(out).not.toContain('useMainThreadRef(null)');
    // The destructure preamble bridges captures via this["_c"].
    expect(out).toContain(`this["_c"]`);
  });

  it('produces matching wkltIds between BG and MT for the same source', () => {
    const source = `
      import { useMainThreadRef } from '@sigx/lynx-runtime-main';
      export function MyComp() {
        const ref = useMainThreadRef(null);
        return _jsx('view', {
          'main-thread-bindtap': () => { 'main thread'; ref.current?.setStyleProperties({ opacity: '0.5' }); },
        });
      }
    `;
    const bgOut = bg(source);
    const mtOut = mt(source);
    const bgId = bgOut.match(/_wkltId:\s*"([^"]+)"/)?.[1];
    const mtId = mtOut.match(/registerWorkletInternal\(\s*"main-thread"\s*,\s*"([^"]+)"/)?.[1];
    expect(bgId).toBeTruthy();
    expect(mtId).toBeTruthy();
    expect(bgId).toBe(mtId);
  });

  it('handles runOnMainThread callbacks the same way as event handlers', () => {
    const source = `
      import { runOnMainThread } from '@sigx/lynx-runtime-main';
      export function MyComp() {
        const animate = runOnMainThread((scale) => {
          'main thread';
          console.log('scale=', scale);
        });
        return null;
      }
    `;
    const bgOut = bg(source);
    const mtOut = mt(source);
    // BG: the arrow is replaced with a { _wkltId } placeholder; runOnMainThread
    // receives the placeholder, not a function.
    expect(bgOut).toMatch(/runOnMainThread\(\s*\{\s*_wkltId:/);
    // MT: a registration with the user's parameter name preserved.
    expect(mtOut).toMatch(/registerWorkletInternal\(\s*"main-thread"\s*,\s*"[^"]+"\s*,\s*function\s*\(\s*scale\s*\)/);
  });

  it('does NOT trip on "main thread" appearing inside a string literal', () => {
    // `@sigx/lynx-runtime/dist/index.js` mentions "main thread" inside a
    // runOnBackground error string. A loose substring check would treat
    // this as a worklet file and the upstream LEPUS transform would emit
    // a no-op-with-registrations output rather than the strip-body path.
    // Verify the directive regex correctly classifies this as no-directive.
    const source = `
      throw Error("runOnBackground() can only be used inside 'main thread' functions.");
    `;
    const out = mt(source);
    // No registerWorkletInternal — the loader treated it as a no-directive file.
    expect(out).not.toContain('registerWorkletInternal');
  });

  it('recognizes ASI-style directives without an explicit semicolon', () => {
    // JavaScript allows the directive prologue to rely on automatic
    // semicolon insertion: `'main thread'\n...` (newline as the
    // statement terminator) is valid. The pre-filter must accept this
    // form, otherwise the SWC transform never runs and the worklet is
    // never registered on MT.
    const source = `
      export function pulse(sv) {
        'main thread'
        sv.value = sv.value + 1
      }
    `;
    const out = mt(source, '/repo/node_modules/@sigx/lynx-foo/dist/index.js');
    expect(out).toContain('registerWorkletInternal');
  });

  it('preserves runtime-main-style library files verbatim (no directive, no allowlist needed)', () => {
    // The MT loader runs on every JS/TS file in the MT layer — no package
    // allowlist. `@sigx/lynx-runtime-main`'s dist files install MT globals
    // (processData, updateGlobalProps, sigxRunOnMT) at top level without
    // a `'main thread'` directive. The loader must recognize them as
    // library code (under `dist/`) and pass their bodies through, or the
    // app fails to boot with "processData is not defined" on Lepus.
    const source = `
      globalThis.processData = function (data) { return data ?? {}; };
      globalThis.updateGlobalProps = function () {};
      globalThis.sigxRunOnMT = function () {};
    `;
    const out = mt(source, '/repo/packages/lynx-runtime-main/dist/entry-main.js');
    expect(out).toBe(source);
  });

  it('auto-includes new worklet-shipping packages without a plugin edit', () => {
    // The whole point of removing the per-package allowlist: any package
    // (sigx-internal or external) that publishes `'main thread'` directives
    // in its dist is processed automatically based on the directive's
    // presence — no editing the plugin and no package.json opt-in flag.
    const source = `
      export function pulse(sv) {
        "main thread";
        sv.value = sv.value + 1;
      }
    `;
    const out = mt(source, '/repo/node_modules/@sigx/lynx-fancy-effects/dist/index.js');
    // Worklet registered on the MT side.
    expect(out).toContain('registerWorkletInternal');
    // Original `export function pulse` preserved so BG-side consumers
    // can still import it by name (rspack shares module identity across
    // layers in the current version).
    expect(out).toContain('export function pulse');
  });

  it('transforms library files that DO contain a directive AND preserves their exports', () => {
    // Pre-built `@sigx/lynx-motion` dist preserves `"main thread"` directives
    // at function tops. The MT loader must run the LEPUS transform on them
    // so SharedValue writes from those packages actually tick on MT, but
    // it must also keep the file's `export` statements intact — rspack
    // shares module identity across BG/MT layers in this version, so
    // stripping the body wipes exports for BG-side consumers (like
    // `@sigx/lynx-daisyui` importing `useTabs` from `@sigx/lynx-navigation`).
    const source = `
      export function withSpring(sv, target) {
        "main thread";
        sv.value = target;
      }
    `;
    const out = mt(source, '/repo/packages/lynx-motion/dist/index.js');
    // Worklet is registered for MT.
    expect(out).toContain('registerWorkletInternal');
    // Original `export function withSpring` is preserved verbatim.
    expect(out).toContain('export function withSpring');
    // Library output skips the bootstrap preamble — user entry code already
    // pulled runtime-main in before this file is evaluated.
    expect(out).not.toContain('entry-main.js');
  });
});
