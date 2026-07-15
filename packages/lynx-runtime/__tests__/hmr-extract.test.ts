/**
 * Tests for the BG-side hot-update extraction helpers (#637).
 *
 * Inputs mimic `factory.toString()` of compiled MT hot-update modules: the
 * loader-emitted namespace binding + registrations survive webpack module
 * compilation verbatim in dev builds.
 */

import { describe, expect, it } from 'vitest';
import {
  extractRegistrations,
  extractSnapshotRegistrations,
} from '../src/hmr-extract';

const FACTORY = `
function (module, exports, __webpack_require__) {
  "use strict";
  const ReactLynx = globalThis.__sigxSnapshotInternal;
  const __snapshot_ab12_cd34_1 = "__snapshot_ab12_cd34_1";
  ReactLynx.snapshotCreatorMap[__snapshot_ab12_cd34_1] = (__snapshot_ab12_cd34_1)=>ReactLynx.createSnapshot(__snapshot_ab12_cd34_1, function() {
      const pageId = ReactLynx.__pageId;
      const el = __CreateView(pageId);
      __SetClasses(el, "grid(2)[nasty] // not a comment");
      return [el];
  }, [
      (snapshot, index, oldValue)=>ReactLynx.updateEvent(snapshot, index, oldValue, 0, "bindEvent", "tap", '')
  ], null, undefined, '__Card__', [0], true);
  registerWorkletInternal("main-thread", "ab:1", function(e) {
    console.log("tap(", e, ")");
  });
}
`;

describe('extractSnapshotRegistrations', () => {
  it('extracts decls + assignments and rebinds the namespace to __SigxSnap', () => {
    const out = extractSnapshotRegistrations(FACTORY);
    expect(out).toContain('const __snapshot_ab12_cd34_1 = "__snapshot_ab12_cd34_1";');
    expect(out).toContain('__SigxSnap.snapshotCreatorMap[__snapshot_ab12_cd34_1]');
    expect(out).toContain('__SigxSnap.createSnapshot(');
    expect(out).toContain('__SigxSnap.__pageId');
    expect(out).toContain('__SigxSnap.updateEvent(');
    expect(out).not.toMatch(/\bReactLynx\./);
    // The nasty attribute string survives the balanced scan intact.
    expect(out).toContain('grid(2)[nasty] // not a comment');
    // Component/factory scaffolding is not included.
    expect(out).not.toContain('__webpack_require__');
    expect(out).not.toContain('registerWorkletInternal');
  });

  it('declarations precede their assignments', () => {
    const out = extractSnapshotRegistrations(FACTORY);
    expect(out.indexOf('const __snapshot_ab12_cd34_1'))
      .toBeLessThan(out.indexOf('snapshotCreatorMap['));
  });

  it('returns empty without the namespace binding line', () => {
    const noBinding = FACTORY.replace(
      'const ReactLynx = globalThis.__sigxSnapshotInternal;',
      '',
    );
    expect(extractSnapshotRegistrations(noBinding)).toBe('');
  });

  it('returns empty for worklet-only factories', () => {
    const workletOnly = `
function (module) {
  registerWorkletInternal("main-thread", "zz:9", function() {});
}
`;
    expect(extractSnapshotRegistrations(workletOnly)).toBe('');
  });

  it('handles a non-default namespace local', () => {
    const renamed = FACTORY.replace(/ReactLynx/g, 'Zed$1x');
    const out = extractSnapshotRegistrations(renamed);
    expect(out).toContain('__SigxSnap.snapshotCreatorMap[');
    expect(out).not.toContain('Zed$1x.');
  });
});

describe('extractRegistrations (worklets, string-aware)', () => {
  it('still extracts worklet registrations alongside snapshot code', () => {
    const out = extractRegistrations(FACTORY);
    expect(out).toContain('registerWorkletInternal("main-thread", "ab:1"');
    // The body's string containing an unbalanced paren doesn't truncate it.
    expect(out).toContain('console.log("tap(", e, ")")');
  });
});
