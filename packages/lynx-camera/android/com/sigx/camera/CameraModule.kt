package com.sigx.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.sigx.permissions.MediaCapture
import com.sigx.permissions.PermissionHelper

/**
 * Camera capture module using system camera intent.
 * JS usage: NativeModules.Camera.takePicture({ quality: 0.8 }, callback)
 */
class CameraModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "CameraModule"
        const val REQUEST_IMAGE_CAPTURE = 9001
    }

    @LynxMethod
    fun takePicture(options: com.lynx.react.bridge.ReadableMap?, callback: Callback?) {
        // The autolinker injects `android.permission.CAMERA` into the manifest,
        // and once an app *declares* CAMERA the system requires it to be GRANTED
        // before ACTION_IMAGE_CAPTURE will fire — otherwise the launch is denied
        // ("Permission Denial: ... requires android.permission.CAMERA"). iOS
        // requests at the AVCaptureDevice layer; mirror that here so callers
        // don't have to remember to call requestPermission() first.
        ensureCameraPermission(callback) {
            // Delegates to MediaCapture (in @sigx/lynx-permissions) which holds
            // the ActivityResultContracts.TakePicture launcher. On success the JS
            // callback receives { uri: "content://...", cancelled: false }.
            MediaCapture.takePicture(mContext) { result -> callback?.invoke(result) }
        }
    }

    @LynxMethod
    fun recordVideo(_options: com.lynx.react.bridge.ReadableMap?, callback: Callback?) {
        // Same CAMERA gotcha as takePicture. Additionally, ACTION_VIDEO_CAPTURE
        // requires RECORD_AUDIO to be granted *when the app declares it* (e.g.
        // when @sigx/lynx-audio is also installed); request it only in that case
        // so camera-only apps aren't prompted for a permission they don't hold.
        ensureCameraPermission(callback) {
            if (hasDeclaredPermission(Manifest.permission.RECORD_AUDIO)) {
                PermissionHelper.requestPermission(mContext, "microphone") { mic ->
                    if (mic.getString("status") == "granted") {
                        MediaCapture.recordVideo(mContext) { result -> callback?.invoke(result) }
                    } else {
                        callback?.invoke(errorResult("Microphone permission denied"))
                    }
                }
            } else {
                MediaCapture.recordVideo(mContext) { result -> callback?.invoke(result) }
            }
        }
    }

    /** Run [proceed] only once CAMERA is granted; otherwise report an error. */
    private fun ensureCameraPermission(callback: Callback?, proceed: () -> Unit) {
        PermissionHelper.requestPermission(mContext, "camera") { perm ->
            if (perm.getString("status") == "granted") {
                proceed()
            } else {
                callback?.invoke(errorResult("Camera permission denied"))
            }
        }
    }

    /** True if [perm] is declared in the merged manifest (uses-permission). */
    private fun hasDeclaredPermission(perm: String): Boolean {
        return try {
            val info = mContext.packageManager.getPackageInfo(
                mContext.packageName, PackageManager.GET_PERMISSIONS
            )
            info.requestedPermissions?.contains(perm) == true
        } catch (e: Exception) {
            false
        }
    }

    private fun errorResult(message: String): JavaOnlyMap =
        JavaOnlyMap().apply { putString("error", message) }

    @LynxMethod
    fun requestPermission(callback: Callback?) {
        PermissionHelper.requestPermission(mContext, "camera") { result ->
            callback?.invoke(result)
        }
    }

    @LynxMethod
    fun getPermissionStatus(callback: Callback?) {
        val result = PermissionHelper.checkPermission(mContext, "camera")
        callback?.invoke(result)
    }
}

