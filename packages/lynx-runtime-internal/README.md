# @sigx/lynx-runtime-internal

> **Internal package.** Shared type declarations only. If you're writing application code, depend on [`@sigx/lynx`](https://github.com/signalxjs/lynx/tree/main/packages/lynx) instead — the public surface is re-exported there.

Shared types for the BG ↔ MT wire protocol used by [`@sigx/lynx-runtime`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-runtime) and [`@sigx/lynx-runtime-main`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-runtime-main). Re-exports nothing user-facing; ship-time decoupling only.

## Contents

- **`OP`** — the numeric op codes that travel from the background thread to the main thread (`CREATE`, `SET_STYLE`, `SET_WORKLET_EVENT`, `INIT_MT_REF`, `REGISTER_AV_BRIDGE`, etc.). Both runtime packages import these so they stay aligned.
- **`MapperParams`, `BuiltinMapperName`, `AnimatedStyleMapper`** — the type signatures consumed by `useAnimatedStyle` (`@sigx/lynx-gestures`) and the MT-side mapper registry (`@sigx/lynx-runtime-main`).

## License

MIT
