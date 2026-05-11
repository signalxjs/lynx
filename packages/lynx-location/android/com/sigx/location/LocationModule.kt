package com.sigx.location

import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.sigx.permissions.PermissionHelper
import com.lynx.react.bridge.ReadableMap

/**
 * Location services module using Android LocationManager.
 * JS usage: NativeModules.Location.getCurrentPosition({ accuracy: "high" }, callback)
 */
class LocationModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "LocationModule"
    }

    @LynxMethod
    fun getCurrentPosition(options: ReadableMap?, callback: Callback?) {
        try {
            val hasPermission = ContextCompat.checkSelfPermission(
                mContext, android.Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (!hasPermission) {
                val error = JavaOnlyMap()
                error.putString("error", "Location permission not granted")
                callback?.invoke(error)
                return
            }

            val locationManager = mContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val provider = LocationManager.NETWORK_PROVIDER

            @Suppress("MissingPermission")
            val location: Location? = locationManager.getLastKnownLocation(provider)
                ?: locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)

            if (location != null) {
                val result = JavaOnlyMap()
                result.putDouble("latitude", location.latitude)
                result.putDouble("longitude", location.longitude)
                result.putDouble("altitude", location.altitude)
                result.putDouble("accuracy", location.accuracy.toDouble())
                result.putDouble("speed", location.speed.toDouble())
                result.putDouble("heading", location.bearing.toDouble())
                result.putDouble("timestamp", location.time.toDouble())
                callback?.invoke(result)
            } else {
                val error = JavaOnlyMap()
                error.putString("error", "Unable to get current location")
                callback?.invoke(error)
            }
        } catch (e: Exception) {
            val error = JavaOnlyMap()
            error.putString("error", e.message ?: "Unknown error")
            callback?.invoke(error)
        }
    }

    @LynxMethod
    fun requestPermission(callback: Callback?) {
        PermissionHelper.requestPermission(mContext, "location_when_in_use") { result ->
            callback?.invoke(result)
        }
    }

    @LynxMethod
    fun getPermissionStatus(callback: Callback?) {
        val result = PermissionHelper.checkPermission(mContext, "location_when_in_use")
        callback?.invoke(result)
    }
}

