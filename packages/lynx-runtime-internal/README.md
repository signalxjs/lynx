# @sigx/lynx-runtime-internal

Shared types for the BG ↔ MT wire protocol used by [`@sigx/lynx-runtime`](../lynx-runtime) and [`@sigx/lynx-runtime-main`](../lynx-runtime-main). Re-exports nothing user-facing; ship-time decoupling only.

## Contents

- **`OP`** — the numeric op codes that travel from the background thread to the main thread (`CREATE`, `SET_STYLE`, `SET_WORKLET_EVENT`, `INIT_MT_REF`, `REGISTER_AV_BRIDGE`, etc.). Both runtime packages import these so they stay aligned.
- **`MapperParams`, `BuiltinMapperName`, `AnimatedStyleMapper`** — the type signatures consumed by `useAnimatedStyle` (`@sigx/gestures`) and the MT-side mapper registry (`@sigx/lynx-runtime-main`).

> If you're writing application code, you don't need to depend on this package — the public surface is re-exported through [`@sigx/lynx`](../lynx).

## License

MIT
