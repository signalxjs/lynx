/**
 * Platform side effect: register the standard built-in directives (`show`) so
 * the `use:show` shorthand resolves at runtime. Imported for side effect by
 * `@sigx/lynx-runtime`'s entry — analogous to runtime-dom's `platform.ts`.
 * (`show`'s JSX `use:show` type augmentation rides `./show.js` itself.)
 *
 * Custom directives register through the seams instead: `app.directive(name,
 * def)` per app, or `registerBuiltInDirective(name, def)` globally.
 */
import { registerBuiltInDirective } from './index.js';
import { show } from './show.js';

registerBuiltInDirective('show', show);
