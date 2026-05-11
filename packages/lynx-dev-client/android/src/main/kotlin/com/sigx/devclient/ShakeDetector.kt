package com.sigx.devclient

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.sqrt

/**
 * Detects device shakes using the accelerometer.
 * Ported from React Native's ShakeDetector
 * (ReactAndroid/.../common/ShakeDetector.java) — requires sustained
 * high-magnitude motion within a short window, not a single spike,
 * so casual handling does not trigger it.
 */
class ShakeDetector(
    private val context: Context,
    private val onShake: () -> Unit
) : SensorEventListener {

    private var sensorManager: SensorManager? = null

    private val timestamps = LongArray(MAX_SAMPLES)
    private val magnitudes = FloatArray(MAX_SAMPLES)
    private var currentIndex = 0
    private var numShakes = 0
    private var lastTimestamp = 0L

    companion object {
        private const val MAX_SAMPLES = 25
        private const val MIN_TIME_BETWEEN_SAMPLES_NS = 20_000_000L   // 20 ms
        private const val VISIBLE_TIME_RANGE_NS = 500_000_000L        // 500 ms
        private const val ACCELERATION_THRESHOLD = 15f                // m/s² (~1.5× gravity)
        private const val MIN_NUM_SHAKES = 1
    }

    fun start() {
        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sensor ->
            sensorManager?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
        }
        reset()
    }

    fun stop() {
        sensorManager?.unregisterListener(this)
        sensorManager = null
        reset()
    }

    override fun onSensorChanged(event: SensorEvent?) {
        val e = event ?: return
        if (e.timestamp - lastTimestamp < MIN_TIME_BETWEEN_SAMPLES_NS) return
        lastTimestamp = e.timestamp

        val ax = e.values[0]
        val ay = e.values[1]
        val az = e.values[2]

        timestamps[currentIndex] = e.timestamp
        magnitudes[currentIndex] = sqrt(ax * ax + ay * ay + az * az)

        maybeDispatchShake(e.timestamp)
        currentIndex = (currentIndex + 1) % MAX_SAMPLES
    }

    private fun maybeDispatchShake(now: Long) {
        if (numShakes >= 8 * MIN_NUM_SHAKES) {
            reset()
            onShake()
            return
        }

        var count = 0
        for (i in 0 until MAX_SAMPLES) {
            val idx = (currentIndex - i + MAX_SAMPLES) % MAX_SAMPLES
            if (now - timestamps[idx] > VISIBLE_TIME_RANGE_NS) break
            if (magnitudes[idx] > ACCELERATION_THRESHOLD) {
                count++
            }
        }
        numShakes = count
    }

    private fun reset() {
        numShakes = 0
        lastTimestamp = 0L
        currentIndex = 0
        for (i in 0 until MAX_SAMPLES) {
            timestamps[i] = 0L
            magnitudes[i] = 0f
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
