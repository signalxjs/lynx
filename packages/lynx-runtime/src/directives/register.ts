/**
 * Platform side effect: register the standard built-in directives (`show`) and
 * pull in their JSX types, so the `use:show` shorthand resolves at runtime and
 * has IntelliSense. Imported for side effect by `@sigx/lynx-runtime`'s entry —
 * analogous to runtime-dom's `platform.ts`.
 *
 * Custom directives register through the seams instead: `app.directive(name,
 * def)` per app, or `registerBuiltInDirective(name, def)` globally.
 */
import './show-jsx-types.js';
import { registerBuiltInDirective } from './index.js';
import { show } from './show.js';

registerBuiltInDirective('show', show);
