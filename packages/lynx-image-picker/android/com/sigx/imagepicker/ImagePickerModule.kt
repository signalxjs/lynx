package com.sigx.imagepicker

import android.content.Context
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.sigx.permissions.PermissionHelper

/**
 * Image picker module for selecting images/videos from gallery.
 * JS usage: NativeModules.ImagePicker.pickImage({ quality: 0.8 }, callback)
 */
class ImagePickerModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "ImagePickerModule"
        const val REQUEST_PICK_IMAGE = 9002
    }

    @LynxMethod
    fun pickImage(options: ReadableMap?, callback: Callback?) {
        // Delegates to MediaCapture (in @sigx/lynx-permissions) — the
        // ActivityResultContracts.PickVisualMedia launcher registered at
        // MainActivity.onCreate. No CAMERA / READ_MEDIA permission needed —
        // Android 13+'s photo picker grants per-pick access on the fly.
        com.sigx.permissions.MediaCapture.pickImage { result ->
            callback?.invoke(result)
        }
    }

    @LynxMethod
    fun pickVideo(options: ReadableMap?, callback: Callback?) {
        // TODO: video picker via PickVisualMedia(VideoOnly). For now stubs
        // out the same shape so the JS layer doesn't crash.
        val result = JavaOnlyMap()
        result.putBoolean("canceled", true)
        result.putArray("assets", JavaOnlyArray())
        callback?.invoke(result)
    }

    @LynxMethod
    fun requestPermission(callback: Callback?) {
        PermissionHelper.requestPermission(mContext, "photo_library") { result ->
            callback?.invoke(result)
        }
    }

    @LynxMethod
    fun getPermissionStatus(callback: Callback?) {
        val result = PermissionHelper.checkPermission(mContext, "photo_library")
        callback?.invoke(result)
    }
}

