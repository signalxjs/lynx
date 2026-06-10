# @sigx/lynx-runtime-internal

> **Internal package.** Shared type declarations only. If you're writing application code, depend on [`@sigx/lynx`](https://sigx.dev/lynx/) instead — the public surface is re-exported there.

Shared types for the BG ↔ MT wire protocol used by [`@sigx/lynx-runtime`](https://sigx.dev/lynx/modules/runtime/overview/) and [`@sigx/lynx-runtime-main`](https://sigx.dev/lynx/modules/runtime-main/overview/). Re-exports nothing user-facing; ship-time decoupling only.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/](https://sigx.dev/lynx/)**

## Contents

- **`OP`** — the numeric op codes that travel from the background thread to the main thread (`CREATE`, `SET_STYLE`, `SET_WORKLET_EVENT`, `INIT_MT_REF`, `REGISTER_AV_BRIDGE`, etc.). Both runtime packages import these so they stay aligned.
- **`MapperParams`, `BuiltinMapperName`, `AnimatedStyleMapper`** — the type signatures consumed by `useAnimatedStyle` (`@sigx/lynx-gestures`) and the MT-side mapper registry (`@sigx/lynx-runtime-main`).

## License

MIT
