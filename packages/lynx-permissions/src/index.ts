/**
 * @sigx/lynx-permissions — shared Android permission helper.
 *
 * This package ships only Android Kotlin source (PermissionHelper.kt +
 * MediaCapture.kt). It is a regular dependency of the permission-using
 * modules (audio/camera/file-picker/image-picker/location/notifications),
 * so the auto-linker pulls it in transitively. The host's Activity must
 * call:
 *
 *   - `PermissionHelper.setActivity(this)` in `onResume()`
 *   - `PermissionHelper.clearActivity()` in `onPause()`
 *   - `PermissionHelper.onRequestPermissionsResult(requestCode, permissions, grantResults)`
 *     in `onRequestPermissionsResult(...)`
 *
 * No JS surface today — modules call the Kotlin helper internally. If a
 * cross-platform JS-side `permissions.request('camera')` API ever lands, it
 * goes here.
 */
export {};
