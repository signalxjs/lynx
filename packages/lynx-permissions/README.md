# @sigx/lynx-permissions

> **Android-only infrastructure.** Apps typically don't need to install this directly — every permission-using module ([`@sigx/lynx-audio`](https://sigx.dev/lynx/modules/audio/overview/), [`@sigx/lynx-camera`](https://sigx.dev/lynx/modules/camera/overview/), [`@sigx/lynx-file-picker`](https://sigx.dev/lynx/modules/file-picker/overview/), [`@sigx/lynx-image-picker`](https://sigx.dev/lynx/modules/image-picker/overview/), [`@sigx/lynx-location`](https://sigx.dev/lynx/modules/location/overview/), [`@sigx/lynx-notifications`](https://sigx.dev/lynx/modules/notifications/overview/)) declares it as a dependency, and the auto-linker walks transitive dependencies, so it links automatically. This README is for native-module *authors*.

Provides the shared `PermissionHelper` + `MediaCapture` Kotlin classes that the listed modules dispatch through to show OS permission dialogs and receive Activity Result callbacks. iOS doesn't need this — `UIImagePickerController`/`CLLocationManager`/etc. handle their own prompts.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/permissions/overview/](https://sigx.dev/lynx/modules/permissions/overview/)**

## Install

Normally nothing to do — installing any of the modules above brings this in transitively, and `sigx prebuild` auto-discovers it and copies the Kotlin sources (`PermissionHelper.kt` + `MediaCapture.kt`) into your Android source tree. A direct `pnpm add @sigx/lynx-permissions` also works (e.g. when authoring a native module against it) and links the same way.

## How it works

The app template's `MainActivity.kt` reflectively wires this module on lifecycle hooks:

- `onResume` → `PermissionHelper.setActivity(this)`
- `onPause` → `PermissionHelper.clearActivity()`
- `onCreate` → `MediaCapture.register(this)` (Activity Result API launchers — must be wired before `STARTED` state)
- `onRequestPermissionsResult` → `PermissionHelper.onRequestPermissionsResult(...)`

The `try { Class.forName(...).getDeclaredField("INSTANCE").get(null) } catch { /* not present */ }` pattern means the wiring silently no-ops in apps that don't have this module on the classpath — so adding/removing it is a one-line `pnpm add`/`pnpm remove` away.

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

Audio + Camera + FilePicker + ImagePicker + Location + Notifications all need the same `requestPermissions()` / Activity Result plumbing on Android. Without a shared layer, each module would re-implement Activity Result wiring, hold its own static `Activity` reference, and fight over `onRequestPermissionsResult` request codes. Centralizing it here keeps each consumer module trivially small and avoids overlapping request-code namespaces.

iOS has no equivalent because the OS-level pickers (`UIImagePickerController`, `PHPickerViewController`, `CLLocationManager`) all handle their own permission flows internally.

## Reference

[`packages/lynx-cli/templates/android/app/src/main/kotlin/__package__/MainActivity.kt`](https://github.com/signalxjs/lynx/blob/main/packages/lynx-cli/templates/android/app/src/main/kotlin/__package__/MainActivity.kt) is the canonical example of how an `Activity` integrates with this module via reflection.
