/**
 * CSS extraction pipeline for SignalX Lynx.
 *
 * Mirrors the behaviour of `@lynx-js/react-rsbuild-plugin`'s `applyCSS()`:
 *   1. Disables `style-loader` (forces CSS extraction via CssExtractPlugin).
 *   2. Replaces the rsbuild-default CssExtract plugin with
 *      `@lynx-js/css-extract-webpack-plugin` which emits Lynx-compatible CSS.
 *   3. Removes `lightningcss-loader` (Lynx has its own CSS processor).
 *   4. Configures the Main-Thread layer to ignore CSS entirely.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CSSLoaderOptions, RsbuildPluginAPI } from '@rsbuild/core';

import type { CssExtractRspackPluginOptions } from '@lynx-js/css-extract-webpack-plugin';

import { LAYERS } from './layers.js';

export interface ApplyCSSOptions {
  enableCSSSelector: boolean;
  enableCSSInvalidation: boolean;
}

const _dirname = path.dirname(fileURLToPath(import.meta.url));

export function applyCSS(
  api: RsbuildPluginAPI,
  options: ApplyCSSOptions,
): void {
  const { enableCSSSelector, enableCSSInvalidation } = options;

  // ① Force CSS extraction (disable style-loader, enable CssExtractPlugin).
  // Without this, rsbuild injects CSS via JS — useless in Lynx's native env.
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
    return mergeRsbuildConfig(config, {
      output: { injectStyles: false },
    });
  });

  // ② Replace the rsbuild-default CSS extraction plugin with the Lynx-aware
  //    one, configure loaders per layer, and remove lightningcss.
  api.modifyBundlerChain(
    async function handler(chain, { CHAIN_ID }) {
      // Rspack only: `@lynx-js/css-extract-webpack-plugin` 0.8.0 dropped
      // webpack support and deleted `CssExtractWebpackPlugin` outright, the
      // same release boundary `@lynx-js/template-webpack-plugin` crossed at
      // 0.12.0. rspeedy drives rspack, so the old `bundlerType` branch could
      // only ever have picked the rspack plugin anyway.
      const { CssExtractRspackPlugin: CssExtractPlugin } = await import(
        '@lynx-js/css-extract-webpack-plugin'
      );

      const cssRules = [
        CHAIN_ID.RULE.CSS,
        CHAIN_ID.RULE.SASS,
        CHAIN_ID.RULE.LESS,
        CHAIN_ID.RULE.STYLUS,
      ] as const;

      // Rsbuild 2 nests the CSS loaders under `oneOf` sub-rules: the `css`
      // rule itself carries only `test` + `dependency` and has NO `uses`, and
      // the real chain (mini-css-extract → css-loader → lightningcss →
      // postcss) lives in `oneOf(CSS_MAIN)`, alongside CSS_RAW / CSS_TEXT /
      // CSS_URL / CSS_INLINE. Operating on the parent rule — which is what
      // this did before, and which rsbuild 1 supported — silently no-ops:
      // every `.use()` and `.delete()` lands on an empty `uses`, the
      // main-thread clone never gets `ignore-css-loader`, and raw CSS reaches
      // rspack's JS parser (`@tailwind base;` → `Expression expected`).
      //
      // Mirrors `@lynx-js/react-rsbuild-plugin`'s own port, including the two
      // details that are easy to miss: `test` still lives on the PARENT rule,
      // and `dependency: { not: 'url' }` has to be carried over or the
      // main-thread clone also matches `url()` dependencies.
      cssRules
        .filter((rule) => chain.module.rules.has(rule))
        .forEach((ruleName) => {
          const rule = chain.module.rule(ruleName);
          const mainRuleName = ruleName === CHAIN_ID.RULE.CSS
            ? CHAIN_ID.ONE_OF.CSS_MAIN
            : ruleName;
          const mainRule = rule.oneOf(mainRuleName);
          const parentRuleEntries = rule.entries() as Record<string, any>;

          // Remove lightningcss-loader — Lynx processes CSS natively.
          removeLightningCSS(mainRule, CHAIN_ID);

          // Use the Lynx CssExtract loader for the Background layer.
          mainRule
            .issuerLayer(LAYERS.BACKGROUND)
            .use(CHAIN_ID.USE.MINI_CSS_EXTRACT)
            .loader(CssExtractPlugin.loader)
            .end();

          // Clone the existing CSS rule chain for the Main-Thread layer.
          // Main-Thread bundles never contain user CSS — only the PAPI
          // bootstrap code.  We replace all loaders with ignore-css + a
          // css-loader configured for `exportOnlyLocals: true`.
          const uses = mainRule.uses.entries() ?? {};
          const ruleEntries = mainRule.entries() as Record<string, any>;
          const cssLoaderRule = uses[CHAIN_ID.USE.CSS]?.entries() as
            | Record<string, any>
            | undefined;

          // A CSS rule with no css-loader is not a shape we can serve: the
          // main-thread clone exists to swap css-loader for
          // `exportOnlyLocals`, and without it that layer would end up with no
          // CSS handling at all. Upstream returns quietly here; we don't —
          // this whole change exists because a bundler-shape drift silently
          // no-opped the same surgery, and a second silent skip in the same
          // function is the last thing this file needs. Fail with the rule
          // name so the next drift points at itself.
          if (!cssLoaderRule) {
            throw new Error(
              `[@sigx/lynx-plugin] CSS rule "${ruleName}" has no `
              + `"${CHAIN_ID.USE.CSS}" loader under `
              + `oneOf("${mainRuleName}"), so the main-thread layer cannot be `
              + `configured. This usually means the bundler changed its rule `
              + `shape again — compare against `
              + `@lynx-js/react-rsbuild-plugin's applyCSS. See #975.`,
            );
          }

          const mtRule = chain.module
            .rule(`${ruleName}:${LAYERS.MAIN_THREAD}`)
            .test(parentRuleEntries['test'])
            .merge(ruleEntries)
            .issuerLayer(LAYERS.MAIN_THREAD);
          if (parentRuleEntries['dependency'] !== undefined) {
            mtRule.merge({ dependency: parentRuleEntries['dependency'] });
          }

          mtRule
            .use(CHAIN_ID.USE.IGNORE_CSS)
            .loader(path.resolve(_dirname, './loaders/ignore-css-loader'))
            .end()
            .uses.merge(uses)
            .delete(CHAIN_ID.USE.MINI_CSS_EXTRACT)
            .delete(CHAIN_ID.USE.LIGHTNINGCSS)
            .delete(CHAIN_ID.USE.CSS)
            .end()
            // Re-add css-loader with exportOnlyLocals for main-thread.
            .use(CHAIN_ID.USE.CSS)
            .after(CHAIN_ID.USE.IGNORE_CSS)
            .merge(cssLoaderRule)
            .options(
              normalizeCssLoaderOptions(
                cssLoaderRule['options'] as CSSLoaderOptions,
                true,
              ),
            )
            .end();
        });

      // Also strip lightningcss from inline CSS, which is its own `oneOf`.
      cssRules
        .filter((rule) => chain.module.rules.has(rule))
        .forEach((ruleName) => {
          const inlineRuleName = ruleName === CHAIN_ID.RULE.CSS
            ? CHAIN_ID.ONE_OF.CSS_INLINE
            : `${ruleName}-inline`;
          removeLightningCSS(
            chain.module.rule(ruleName).oneOf(inlineRuleName),
            CHAIN_ID,
          );
        });

      // ③ Replace the CssExtract plugin instance with the Lynx-aware one
      //    and pass through the CSS selector / invalidation options.
      chain
        .plugin(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT)
        .tap((args: any[]) => {
          const [pluginOptions] = args;
          return [
            {
              ...pluginOptions,
              enableRemoveCSSScope: true,
              enableCSSSelector,
              enableCSSInvalidation,
              cssPlugins: [],
            } as CssExtractRspackPluginOptions,
          ];
        })
        // The cast is the honest shape of this call: webpack-chain types
        // `init` as returning its own `PluginInstance`, but the whole point
        // here is to swap in the Lynx encoder's plugin, which is a foreign
        // class. Nothing downstream reads it as anything but an applied
        // plugin.
        .init(((_: unknown, args: unknown[]) =>
          new CssExtractPlugin(
            ...(args as [options: CssExtractRspackPluginOptions]),
          )) as never)
        .end()
        .end();

      // Accepts a `oneOf` sub-rule as well as a top-level rule — under
      // rsbuild 2 the loaders live one level down, so both shapes reach here.
      function removeLightningCSS(
        rule: { uses: { has(k: string): boolean; delete(k: string): unknown } },
        ids: typeof CHAIN_ID,
      ): void {
        if (rule.uses.has(ids.USE.LIGHTNINGCSS)) {
          rule.uses.delete(ids.USE.LIGHTNINGCSS);
        }
      }
    },
  );
}

/**
 * Force `exportOnlyLocals: true` on the css-loader modules config.
 * Copied from rsbuild internals — required when the target is not `web`
 * and CSS modules are enabled.
 */
const normalizeCssLoaderOptions = (
  options: CSSLoaderOptions,
  exportOnlyLocals: boolean,
): CSSLoaderOptions => {
  if (options.modules && exportOnlyLocals) {
    let { modules } = options;
    if (modules === true) {
      modules = { exportOnlyLocals: true };
    } else if (typeof modules === 'string') {
      modules = {
        mode: modules as 'local',
        exportOnlyLocals: true,
      };
    } else {
      modules = {
        ...modules,
        exportOnlyLocals: true,
      };
    }

    return {
      ...options,
      modules,
    };
  }

  return options;
};
