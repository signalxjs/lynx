package com.sigx.camera

import android.content.Context
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
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
        // Delegates to MediaCapture (in @sigx/lynx-permissions) which holds
        // the ActivityResultContracts.TakePicture launcher registered at
        // MainActivity.onCreate. On success, the JS callback receives
        // { uri: "content://...", canceled: false } pointing at a JPEG in
        // the app's cacheDir. Quality option is currently ignored — the
        // system camera picks its own settings; we'll plumb it through
        // when we add a CameraX-based custom-UI module.
        com.sigx.permissions.MediaCapture.takePicture(mContext) { result ->
            callback?.invoke(result)
        }
    }

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

