/**
 * Shared permission types for sigx-lynx native modules.
 *
 * All module packages that deal with permissions import these types from
 * @sigx/lynx-core for consistent API surfaces across Camera, Location,
 * Notifications, ImagePicker, etc.
 */

/** Permission status returned by native modules. */
export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'blocked';

/** Response from requestPermission() and getPermissionStatus() calls. */
export interface PermissionResponse {
    /** Current permission status. */
    status: PermissionStatus;
    /**
     * Whether the app can show the OS permission dialog again.
     * `false` when the user selected "Don't ask again" (Android) or
     * after the first denial (iOS — user must go to Settings).
     */
    canAskAgain: boolean;
}
