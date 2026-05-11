/**
 * Webpack/Rspack loader that strips CSS from Main-Thread bundles.
 *
 * In the Lynx dual-thread model, only the Background Thread needs CSS.
 * The Main-Thread layer uses `exportOnlyLocals` from css-loader to get
 * CSS module class name mappings without actual styles.
 */

import type { Rspack } from '@rsbuild/core';

export default function ignoreCssLoader(
  this: Rspack.LoaderContext,
  source: string,
): string {
  this.cacheable(true);

  // If the source contains ___CSS_LOADER_EXPORT___, it is not a CSS Modules
  // file (exportOnlyLocals is enabled), so we don't need to preserve it.
  if (source.includes('___CSS_LOADER_EXPORT___')) {
    return 'export {}';
  }

  // Preserve CSS modules export for background layer.
  return source;
}
