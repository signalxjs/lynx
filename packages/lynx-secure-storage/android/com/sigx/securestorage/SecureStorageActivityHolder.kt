package com.sigx.securestorage

import androidx.fragment.app.FragmentActivity
import java.lang.ref.WeakReference

internal object SecureStorageActivityHolder {

    private var ref: WeakReference<FragmentActivity>? = null

    fun setActivity(activity: FragmentActivity) {
        ref = WeakReference(activity)
    }

    fun clearIf(activity: Any) {
        val current = ref?.get() ?: return
        if (current === activity) {
            ref = null
        }
    }

    fun current(): FragmentActivity? = ref?.get()
}
