import type { CodepointMap } from '../types.js';

/**
 * Empty stub. The @sigx/lynx-plugin icons slice replaces this module via an
 * Rspack alias at build time, populating it with the codepoints used by the
 * app's `<Icon>` calls. Without the plugin, no built-in sets are registered
 * and all icons fall back to `defineIconSet`-registered sets (if any) or the
 * missing-glyph placeholder.
 */
export const codepoints: CodepointMap = {};
