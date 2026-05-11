# @sigx/lynx-permissions

**Android-only infrastructure module.** Provides the shared `PermissionHelper` + `MediaCapture` classes that `@sigx/lynx-camera`, `@sigx/lynx-image-picker`, `@sigx/lynx-location`, and `@sigx/lynx-notifications` all dispatch through to show OS permission dialogs and receive Activity Result callbacks. iOS doesn't need this — `UIImagePickerController`/`CLLocationManager`/etc. handle their own prompts.

You typically don't import this package directly — pull it in transitively by listing it after the modules that need it. Most apps that use Camera/ImagePicker/Location/Notifications will end up declaring it explicitly because the autolinker doesn't currently dedup peer requirements.

## Install

```bash
pnpm add @sigx/lynx-permissions
```

```ts
// sigx.lynx.config.ts
export default defineLynxConfig({
    modules: [
        '@sigx/lynx-permissions',
        '@sigx/lynx-camera',
        '@sigx/lynx-image-picker',
        // ...
    ],
});
```

`sigx prebuild` copies the Kotlin sources (`PermissionHelper.kt` + `MediaCapture.kt`) into your Android source tree.

## How it works

The app template's `MainActivity.kt` reflectively wires this module on lifecycle hooks:

- `onResume` → `PermissionHelper.setActivity(this)`
- `onPause` → `PermissionHelper.clearActivity()`
- `onCreate` → `MediaCapture.register(this)` (Activity Result API launchers — must be wired before `STARTED` state)
- `onRequestPermissionsResult` → `PermissionHelper.onRequestPermissionsResult(...)`

The `try { Class.forName(...).getDeclaredField("INSTANCE").get(null) } catch { /* not present */ }` pattern means the wiring silently no-ops in apps that don't have this module on the classpath — so adding/removing it is a one-line change in `sigx.lynx.config.ts`.

## Public API

The Kotlin classes are consumed by other native modules, not by JS. There's no `index.ts` export here — JS callers go through `@sigx/lynx-camera.requestPermission()` etc.

If you're authoring a new native module that needs runtime permissions on Android, reach into:

```kotlin
import com.sigx.permissions.PermissionHelper

// In a coroutine-friendly context:
val granted = PermissionHelper.request(arrayOf(Manifest.permission.CAMERA))
```

…and for `ActivityResultContracts`:

```kotlin
import com.sigx.permissions.MediaCapture

// MediaCapture.takePicture(uri) etc. — wraps the system intents through
// pre-registered launchers so the call site doesn't need to deal with
// Activity Result lifecycle.
```

## Why a separate module

Camera + ImagePicker + Location + Notifications all need the same `requestPermissions()` plumbing on Android. Without a shared layer, each module would re-implement Activity Result wiring, hold its own static `Activity` reference, and fight over `onRequestPermissionsResult` request codes. Centralizing it here keeps each consumer module trivially small and avoids overlapping request-code namespaces.

iOS has no equivalent because the OS-level pickers (`UIImagePickerController`, `PHPickerViewController`, `CLLocationManager`) all handle their own permission flows internally.

## Reference

The wiring in `packages/lynx-cli/templates/android/app/src/main/kotlin/__package__/MainActivity.kt` is the canonical example of how an `Activity` integrates with this module via reflection.
