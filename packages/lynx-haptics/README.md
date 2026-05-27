# @sigx/lynx-haptics
Vibration and haptic feedback for sigx-lynx. Maps to `UIImpactFeedbackGenerator` / `UINotificationFeedbackGenerator` / `UISelectionFeedbackGenerator` on iOS and `Vibrator` (with `VibrationEffect` amplitude control where available) on Android.
## Install
```bash
pnpm add @sigx/lynx-haptics
```
`sigx prebuild` auto-discovers the package, links the native module, and adds `android.permission.VIBRATE` to your AndroidManifest.
## Usage
```ts
import { Haptics } from '@sigx/lynx-haptics';
Haptics.impact('medium');           // 'light' | 'medium' | 'heavy'
Haptics.notification('success');    // 'success' | 'warning' | 'error'
Haptics.selection();                // light tick — for picker scrolls etc.
```
## API
| Method                                            | Notes                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `impact(style?: ImpactStyle)`                     | One-shot impact. iOS uses `UIImpactFeedbackGenerator`. Android falls back to `VibrationEffect` (light=10ms, medium=20ms, heavy=40ms with amplitude control) or fixed `vibrate(ms)` on older devices.   |
| `notification(type?: NotificationType)`           | Multi-step pattern (success/warning/error). iOS uses `UINotificationFeedbackGenerator`; Android uses pattern arrays.                                                                                   |
| `selection()`                                     | Lightest tick — pickers, toggles. iOS uses `UISelectionFeedbackGenerator`; Android uses 5ms vibrate.                                                                                                   |
| `diagnose(): Promise<HapticsDiagnostics>`         | Android-only diagnostic. Returns `{ hasVibrator, sdk, hasVibratePermission, hasAmplitudeControl }`. Use this to figure out why a device isn't buzzing — most often it's the system "haptics" toggle.   |
| `isAvailable(): boolean`                          | Whether the native module is registered in the current build.                                                                                                                                          |
```ts
type ImpactStyle = 'light' | 'medium' | 'heavy';
type NotificationType = 'success' | 'warning' | 'error';
interface HapticsDiagnostics {
    hasVibrator: boolean;
    sdk?: number;
    hasVibratePermission?: boolean;
    hasAmplitudeControl?: boolean;
}
```
All methods are sync and return `void` — there's no permission flow because `VIBRATE` is auto-granted (it's a normal-level permission on Android, no flow on iOS).
## Gotchas
- **Pixel won't buzz.** First, check **Settings → Sound & vibration → Vibration & haptics** — there's a single global toggle that silently disables every API in this module. Then run `Haptics.diagnose()` to see what `hasVibrator` / `hasAmplitudeControl` report.
- iOS `UIImpactFeedbackGenerator` requires the device be unlocked and the app foregrounded — it no-ops silently otherwise.
