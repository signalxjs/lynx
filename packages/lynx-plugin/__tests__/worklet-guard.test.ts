/**
 * #1021 — a worklet lives as two halves that must agree: a `{_wkltId}`
 * placeholder in the background bundle, and a matching
 * `registerWorkletInternal("main-thread", "<id>", …)` in the main-thread
 * bundle. `runWorklet` looks the body up by that id at runtime.
 *
 * Nothing else compares those two sets, and a mismatch is invisible — the
 * build succeeds, the app starts, and the worklet just never fires. Declaring
 * `sideEffects: false` on packages containing worklets deleted 72 of 101
 * registrations while typecheck, tests, lint and pack all stayed green
 * (#1002): on the MT layer a worklet module is imported for its registration
 * side effect alone, so a bundler told the package is side-effect-free is
 * correct to drop it.
 *
 * These cover the pure id-matching core; the plugin wiring is a thin tap.
 */
import { describe, it, expect } from 'vitest';

import { SigxWorkletGuardPlugin } from '../src/entry';

const reg = (id: string) =>
  `registerWorkletInternal("main-thread", "${id}", function(){});`;
const placeholder = (id: string) => `{_wkltId: "${id}", _c: {}}`;

describe('SigxWorkletGuardPlugin — id extraction', () => {
  it('reads background placeholder ids', () => {
    const bg = `a(${placeholder('dfef:015c8:1')});b(${placeholder('dfef:015c8:2')});`;
    expect([...SigxWorkletGuardPlugin.backgroundIds(bg)]).toEqual([
      'dfef:015c8:1',
      'dfef:015c8:2',
    ]);
  });

  it('reads main-thread registration ids', () => {
    const mt = reg('dfef:015c8:1') + reg('dfef:015c8:2');
    expect([...SigxWorkletGuardPlugin.mainThreadIds(mt)]).toEqual([
      'dfef:015c8:1',
      'dfef:015c8:2',
    ]);
  });


  it('ignores a doc comment that spells out the placeholder shape', () => {
    // Development builds keep comments, and `threading.ts` documents the
    // mechanism with a literal `{ _wkltId: '...' }`. Reading that as a real
    // worklet failed the build on prose (#975 verification).
    const bg = `/* it becomes { _wkltId: '...' } at this call site */`;
    expect(SigxWorkletGuardPlugin.backgroundIds(bg).size).toBe(0);
    expect(SigxWorkletGuardPlugin.missingIds(bg, '')).toEqual([]);
  });

  it('tolerates single quotes and minified spacing', () => {
    // Production output is minified; the check must not depend on the
    // pretty-printed shape it was written against.
    const bg = `{_wkltId:'x:1'}`;
    const mt = `registerWorkletInternal('main-thread','x:1',function(){})`;
    expect(SigxWorkletGuardPlugin.missingIds(bg, mt)).toEqual([]);
  });
});

describe('SigxWorkletGuardPlugin — the check', () => {
  it('passes when every background worklet is registered', () => {
    const bg = placeholder('a:1') + placeholder('a:2');
    const mt = reg('a:1') + reg('a:2');
    expect(SigxWorkletGuardPlugin.missingIds(bg, mt)).toEqual([]);
  });

  it('reports ids that reached BG but were never registered on MT', () => {
    // The #1002 shape: the MT modules were tree-shaken away, so the
    // registrations are simply absent while the BG placeholders remain.
    const bg = placeholder('a:1') + placeholder('a:2') + placeholder('a:3');
    const mt = reg('a:2');
    expect(SigxWorkletGuardPlugin.missingIds(bg, mt)).toEqual(['a:1', 'a:3']);
  });

  it('does not complain about MT registrations with no BG placeholder', () => {
    // The MT bundle legitimately carries registrations the BG never
    // references (runtime-internal worklets). Only the reverse is a defect.
    expect(SigxWorkletGuardPlugin.missingIds('', reg('a:1'))).toEqual([]);
  });

  it('passes for an app with no worklets at all', () => {
    expect(SigxWorkletGuardPlugin.missingIds('const x = 1;', '')).toEqual([]);
  });
});
