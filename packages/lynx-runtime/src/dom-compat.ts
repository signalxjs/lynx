/**
 * DOM-runtime compatibility names (#1059) — the lynx plugin aliases
 * `@sigx/runtime-dom` to THIS package so `sigx`-importing code links in
 * lynx bundles, and the web entry re-exports these names from runtime-dom.
 * ESM linking resolves every re-exported name whether or not it is ever
 * called, so the alias target must carry them all; a graph that reaches the
 * `sigx` entry (e.g. `@sigx/zero`'s behavior chunks, #1058) otherwise dies
 * at link time with `export 'Portal' … was not found`.
 *
 * Semantics are lynx-true, not pretend-DOM: `supportsMoveBefore` is a
 * constant `false`, and the three functions THROW when actually invoked —
 * on this platform overlays go through `@sigx/lynx-zero`'s outlet and there
 * is no document head. Nothing should ever call these; existing at link
 * time is their whole job.
 */

const unsupported = (name: string, hint: string): never => {
  throw new Error(`[@sigx/lynx-runtime] ${name} is a DOM-runtime API with no lynx counterpart — ${hint}`);
};

/** DOM portal component — never renderable on lynx. */
export function Portal(): never {
  return unsupported('Portal', 'portal through an overlay outlet (e.g. @sigx/lynx-zero ZeroRoot) instead');
}

/** DOM `moveBefore`-based node move — no DOM to move nodes in. */
export function moveNode(): never {
  return unsupported('moveNode', 'element order is owned by the lynx element tree');
}

/** The web runtime feature-detects `Element.moveBefore`; lynx has neither. */
export const supportsMoveBefore = false;

/** Document-head manager — there is no document head on lynx. */
export function useHead(): never {
  return unsupported('useHead', 'page chrome is native (see @sigx/lynx-navigation Screen)');
}
