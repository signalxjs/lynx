/**
 * @sigx/lynx-permissions — shared Android permission helper.
 *
 * This package ships only Android Kotlin source (PermissionHelper.kt). It is
 * a peer dependency of camera/location/imagepicker/notifications/filesystem
 * modules that need to check or request runtime permissions. The host's
 * Activity must call:
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
