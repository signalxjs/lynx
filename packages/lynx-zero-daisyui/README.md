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

## Sizes: the skin's `rem` is compiled to px at 16px/rem

Lynx resolves `rem` against its 14px default page font size, not the web's
16px, so a skin written in `rem` draws 12.5% small on device (the md button
measured 35pt instead of 40). zero-kit's lynx emitter now rewrites every
`rem` length in the compiled CSS to `px` at 16px/rem: tokens, declarations,
`calc()` operands and keyframes. The CSS this package copies then sizes
components the way the web does (xs–xl buttons 24/32/40/48/56). The rewrite
ships with the `@sigx/zero-daisyui` release after 0.9.0
([signalxjs/zero#381](https://github.com/signalxjs/zero/issues/381),
[#1183](https://github.com/signalxjs/lynx/issues/1183)); until then the
copied CSS still carries `rem`.

Your own app CSS is not rewritten. A `rem` in it still resolves at 14px on
lynx, so write `px` for sizes that must match the skin.

The px sizes take part in the OS text size the same way any px does: the
engine scales px on font-relevant properties (font-size, line-height) only,
so text follows the OS setting and control boxes keep their size.

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

On lynx the ring shows when the `focus-visible` flag is set. `@sigx/lynx-zero`
has no keyboard-focus detection yet, so today that is only through
`ForceStates` (`@sigx/lynx-zero/testing`).

## No noise texture and no clip-path on lynx

daisy paints a fractal-noise texture (`--fx-noise`, an SVG data-URI image)
on its checkbox and radio. iOS Lynx cannot decode an SVG data-URI
background: the image load fails, and a dev build shows the red error
screen. zero-kit's lynx emitter now drops every SVG data-URI image, the
tokens that hold one and every declaration that reads such a token. The
texture is decorative, and daisy's default strength is 0.

Lynx does not apply `clip-path` either, so the emitter drops it. daisy cuts
its checkbox tick out of a rotated square with a polygon. On lynx the skin
draws the same L as two borders on a rotated box, and draws the
indeterminate mark as a bar centred in the box. Both changes ship with
`@sigx/zero-daisyui` 0.13.0
([signalxjs/zero#401](https://github.com/signalxjs/zero/issues/401),
[#1215](https://github.com/signalxjs/lynx/issues/1215),
[#1216](https://github.com/signalxjs/lynx/issues/1216),
[#1217](https://github.com/signalxjs/lynx/issues/1217)).
