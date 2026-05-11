package com.sigx.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * Network connectivity status module.
 * JS usage: NativeModules.Network.getState(callback)
 */
class NetworkModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "NetworkModule"
    }

    @LynxMethod
    fun getState(callback: Callback?) {
        try {
            val cm = mContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val result = JavaOnlyMap()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = cm.activeNetwork
                val capabilities = network?.let { cm.getNetworkCapabilities(it) }

                if (capabilities != null) {
                    result.putBoolean("isConnected", true)
                    result.putBoolean("isInternetReachable",
                        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))

                    val type = when {
                        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
                        else -> "unknown"
                    }
                    result.putString("type", type)
                } else {
                    result.putBoolean("isConnected", false)
                    result.putString("type", "none")
                    result.putBoolean("isInternetReachable", false)
                }
            } else {
                @Suppress("DEPRECATION")
                val info = cm.activeNetworkInfo
                result.putBoolean("isConnected", info?.isConnected == true)
                result.putString("type", if (info?.isConnected == true) "unknown" else "none")
                result.putBoolean("isInternetReachable", info?.isConnected == true)
            }

            callback?.invoke(result)
        } catch (e: Exception) {
            val error = JavaOnlyMap()
            error.putString("error", e.message ?: "Unknown error")
            callback?.invoke(error)
        }
    }
}

