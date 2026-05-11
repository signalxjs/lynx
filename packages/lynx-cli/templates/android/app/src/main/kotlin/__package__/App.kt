package {{packageName}}

import android.app.Application
import android.util.Log
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.imagepipeline.memory.PoolConfig
import com.facebook.imagepipeline.memory.PoolFactory
import com.lynx.service.http.LynxHttpService
import com.lynx.service.image.LynxImageService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        initLynxServices()
        initLynxEnv()
        GeneratedModuleRegistry.registerAll(this)
    }

    private fun initLynxServices() {
        val factory = PoolFactory(PoolConfig.newBuilder().build())
        val config = ImagePipelineConfig.newBuilder(applicationContext)
            .setPoolFactory(factory)
            .build()
        Fresco.initialize(applicationContext, config)

        LynxServiceCenter.inst().registerService(LynxImageService.getInstance())
        LynxServiceCenter.inst().registerService(LynxLogService)
        LynxServiceCenter.inst().registerService(LynxHttpService)

        // Register devtool service BEFORE LynxEnv.init() (debug builds only)
        if (BuildConfig.DEBUG) {
            try {
                com.sigx.devclient.SigxDevClient.registerServices()
            } catch (e: Exception) {
                Log.e("SigxApp", "Failed to register dev services", e)
            }
        }
    }

    private fun initLynxEnv() {
        LynxEnv.inst().init(this, null, null, null)
        Log.i("SigxApp", "LynxEnv initialized")

        // Enable devtool/debug flags AFTER init() -- calling before init()
        // has no effect because init() resets these flags.
        if (BuildConfig.DEBUG) {
            try {
                com.sigx.devclient.SigxDevClient.enableDevMode()
            } catch (e: Exception) {
                Log.e("SigxApp", "Failed to enable dev mode", e)
            }
        }
    }
}
