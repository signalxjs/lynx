export { Icon } from './Icon.js';
// The resolver DI key is re-exported from the CSS-free "./context.js" (also the
// "@sigx/lynx-icons/context" subpath) so asset-free consumers — notably the
// theme engine — can take the key alone without pulling Icon's assets.
export { useIconColorResolver } from './context.js';
export type { IconProps } from './Icon.js';
export { defineIconSet } from './defineIconSet.js';
export type {
    GlyphData,
    GlyphSvg,
    IconAdapter,
    IconColorResolver,
    IconPropsExtensions,
    IconSetDef,
    IconSpec,
} from './types.js';
