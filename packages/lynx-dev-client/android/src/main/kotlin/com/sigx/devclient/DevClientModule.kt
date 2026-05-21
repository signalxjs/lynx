package com.sigx.devclient

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback

/**
 * Minimal JS-callable native module exposed by `@sigx/lynx-dev-client`.
 *
 * Lets the JS-side console streamer ask the host runtime which platform it's
 * running on. The BG runtime doesn't populate `lynx.SystemInfo` and has no
 * `navigator.userAgent`, so a tiny native probe is the only reliable source.
 *
 * JS usage:
 *   ```ts
 *   import { callAsync } from '@sigx/lynx-core';
 *   const { platform } = await callAsync<{ platform: string }>(
 *       'DevClient', 'getPlatform',
 *   );
 *   ```
 */
class DevClientModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun getPlatform(callback: Callback?) {
        // Mirror @sigx/lynx-device-info's `getConstants.platform` shape so the
        // streamer can use the same key regardless of which module it ends up
        // calling.
        val map = com.lynx.react.bridge.JavaOnlyMap()
        map.putString("platform", "android")
        callback?.invoke(map)
    }
}
