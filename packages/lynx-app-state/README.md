# @sigx/lynx-app-state

App foreground/background state for sigx-lynx — current value + change events.

Reconnect a WebSocket the instant the app resumes (instead of waiting out a ping timeout), refresh data that went stale while backgrounded, pause timers and media, flush analytics on background.

- **iOS**: `UIApplication.didBecomeActiveNotification` / `didEnterBackgroundNotification` per LynxView.
- **Android**: activity `onResume`/`onPause` via the autolinked activity hook — no androidx dependency.

## 📚 Documentation

Full API and live examples → **[sigx.dev/lynx/modules/app-state/overview](https://sigx.dev/lynx/modules/app-state/overview/)**

## Install

```bash
pnpm add @sigx/lynx-app-state
```

`sigx prebuild` auto-discovers the package and links the native module — zero host wiring.

## A taste

```ts
import { currentAppState, addAppStateListener, useAppState } from '@sigx/lynx-app-state';

currentAppState();                       // 'active' | 'background'

const off = addAppStateListener((state) => {
    if (state === 'active') reconnectSocket();   // fires on every transition, deduped
});

// Reactive — components reading .value re-render on transitions.
const appState = useAppState();
```

### Semantics

- Two-state model: `'active' | 'background'`. iOS's transient `inactive` phase (control-center pull, incoming call) is not modeled — only `didEnterBackground` counts as background, so brief interruptions don't flap listeners.
- Consecutive duplicate events are deduped (multiple LynxViews → multiple native publishers; cold-start `didBecomeActive` is absorbed by the `'active'` default).
- Off-device (web preview, SSR, tests): `isAvailable()` is `false`, `currentAppState()` returns `'active'`, listeners never fire — a safe no-op.
