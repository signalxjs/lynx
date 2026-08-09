/**
 * #951 — standalone entry for the CSS engine probe.
 *
 * Renders ONLY CSSEngineProbeBody: no ThemeProvider, no AppearanceProvider,
 * no navigation — so nothing in JS can correct colors after first paint and
 * the recorded first frame is purely the engine's own CSS resolution.
 *
 * To use, temporarily point the entry at this file in lynx.config.ts:
 *     source: { entry: { main: './src/probe-main.tsx' } }
 * (Build-matrix step in #951; not wired by default.)
 */
import { defineApp } from '@sigx/lynx';
import { CSSEngineProbeBody } from './screens/CSSEngineProbe.js';

defineApp(<CSSEngineProbeBody />).mount(null);

if (module.hot) {
    module.hot.accept();
}
