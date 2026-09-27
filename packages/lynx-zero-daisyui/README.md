# @sigx/lynx-zero-daisyui

daisyUI for SignalX Lynx as **data**: this package writes no components and
no CSS of its own. The recipes live once, in
[`@sigx/zero-daisyui`](https://github.com/signalxjs/zero), where zero-kit's
lynx target compiles them to class-grammar CSS (`.zx-<scope>__<part>`
compounds, every color a baked literal, themes as `.zx-theme-<name>`
blocks). This shell ships those artifacts and seeds the theme registry —
that is the whole package. Part of
[signalxjs/lynx#1029](https://github.com/signalxjs/lynx/issues/1029).

## Use

```tsx
import '@sigx/lynx-zero-daisyui';                 // seeds the theme registry
import '@sigx/lynx-zero-daisyui/css/index.css';   // the compiled skin
import { ZeroRoot } from '@sigx/lynx-zero';

defineApp(() => () => (
    <ZeroRoot>   {/* zx-root + zx-theme-<active> — the tokens' host */}
        <App />
    </ZeroRoot>
));
```

Five themes ship (light, dark, dim, nord, sunset), registered into
`@sigx/zero`'s registry — the same one the web runtime reads — so
`themeController`, light/dark pairing and follow-system work with no
further wiring. Swatches are **baked to hex** at build (the manifest's
oklch spellings are registry-fine on the web, but a lynx view cannot paint
them; a theme picker can paint these directly).

The same import also registers the skin's **axis defaults**
(`DAISY_AXIS_DEFAULTS`, from the manifest's `components.<scope>.defaults`)
into `@sigx/lynx-zero`'s axis-defaults registry, so a `<Button>` with no
`variant`/`size` prop stamps the classes daisyUI's defaults call for —
required on lynx, where the compiled CSS has no `:not()` default twins.

## How the build works

`build.mjs` resolves `@sigx/zero-daisyui`'s `dist/lynx` artifacts through
the package graph, verifies the **class-grammar envelope**
(`manifest.classGrammarVersion` must equal the installed `@sigx/zero`
contract's `CLASS_GRAMMAR_VERSION` — CSS emitted for another grammar would
silently select nothing), generates `src/generated/theme-data.ts`, and
copies the CSS into `dist/css/`. Both `@sigx/zero` and `@sigx/zero-daisyui`
are pinned to the same exact beta in the workspace catalog; bump them
together.

daisyUI declares no scalable `--text-*` ramp, so `setFontScale` re-emission
is a no-op under this skin (documented, not a bug); the ramp constant is
generated empty and will fill in if the skin ever declares one.

## Focus rings on lynx

Lynx's `outline` ignores `border-radius`, and lynx has no `outline-offset`,
so daisy's web ring (`outline: 2px solid; outline-offset: 2px`) paints as a
square box flush on the part. The skin's lynx CSS draws the ring as two
spread box-shadows instead, which follow the part's radius: a 2px gap in the
surface the part sits on, then 2px of the ring's ink. The Accordion
trigger fills its clipping card, so its ring is drawn inset. The Slider
ring is on the thumb only. This ships with the `@sigx/zero-daisyui` release
after 0.7.0 ([signalxjs/zero#365](https://github.com/signalxjs/zero/issues/365),
[#1163](https://github.com/signalxjs/lynx/issues/1163),
[#1164](https://github.com/signalxjs/lynx/issues/1164)).

On lynx the ring shows when the `focus-visible` flag is set. lynx-zero has
no keyboard-focus detection yet, so today that is only through
`ForceStates` (`@sigx/lynx-zero/testing`).
