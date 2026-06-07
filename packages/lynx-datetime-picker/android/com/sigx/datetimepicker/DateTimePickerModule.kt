package com.sigx.datetimepicker

import android.app.Activity
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.text.format.DateFormat
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.sigx.core.SigxActivityHolder
import java.util.Calendar

/**
 * Native date/time picker module — wraps the platform
 * [DatePickerDialog] / [TimePickerDialog] (no Material/AndroidX
 * dependency). `datetime` mode chains the date dialog into the time
 * dialog; cancelling either step cancels the whole pick.
 *
 * JS usage: `NativeModules.DateTimePicker.present(options, callback)`.
 * All instants cross the bridge as epoch milliseconds. The Activity comes
 * from `@sigx/lynx-core`'s shared [SigxActivityHolder], auto-wired via that
 * package's `signalx-module.json`.
 */
class DateTimePickerModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun present(options: ReadableMap?, callback: Callback?) {
        val activity = SigxActivityHolder.current()
        if (activity == null) {
            callback?.invoke(cancelled())
            return
        }

        val mode = options?.takeIf { it.hasKey("mode") }?.getString("mode") ?: "date"
        val initial = Calendar.getInstance().apply {
            optionalMs(options, "value")?.let { timeInMillis = it }
        }
        val minMs = optionalMs(options, "minimumDate")
        val maxMs = optionalMs(options, "maximumDate")
        val is24Hour = options?.takeIf { it.hasKey("is24Hour") }?.getBoolean("is24Hour")
            ?: DateFormat.is24HourFormat(activity)

        // One terminal callback per pick — dialogs can fire both their
        // listener and onCancel during teardown.
        val fired = booleanArrayOf(false)
        val finish: (Long?) -> Unit = { ms ->
            if (!fired[0]) {
                fired[0] = true
                // minimumDate/maximumDate are instant bounds per the JS
                // contract, but DatePickerDialog only constrains the day —
                // picking the min day with an earlier time (datetime mode)
                // or midnight (date mode) can land outside the range, so
                // clamp the combined instant. Ignored in time mode, matching
                // the documented option semantics.
                // Sequential bounds rather than coerceIn — an inverted
                // min/max pair must not throw (max wins if both apply).
                val clamped = ms?.let { v ->
                    var out = v
                    if (mode != "time") {
                        minMs?.let { if (out < it) out = it }
                        maxMs?.let { if (out > it) out = it }
                    }
                    out
                }
                callback?.invoke(if (clamped != null) result(clamped) else cancelled())
            }
        }

        activity.runOnUiThread {
            when (mode) {
                "time" -> showTimeDialog(activity, initial, is24Hour) { hour, minute ->
                    initial.set(Calendar.HOUR_OF_DAY, hour)
                    initial.set(Calendar.MINUTE, minute)
                    initial.set(Calendar.SECOND, 0)
                    initial.set(Calendar.MILLISECOND, 0)
                    finish(initial.timeInMillis)
                }.setOnCancelListener { finish(null) }

                // Widen instant bounds to whole days for the date step —
                // a mid-day minimum must still allow picking the boundary
                // day; the instant clamp in finish() enforces exactness.
                "datetime" -> showDateDialog(
                    activity, initial, minMs?.let(::dayStart), maxMs?.let(::dayEnd),
                ) { y, m, d ->
                    initial.set(y, m, d)
                    // Chain into the time dialog for the time-of-day half.
                    showTimeDialog(activity, initial, is24Hour) { hour, minute ->
                        initial.set(Calendar.HOUR_OF_DAY, hour)
                        initial.set(Calendar.MINUTE, minute)
                        initial.set(Calendar.SECOND, 0)
                        initial.set(Calendar.MILLISECOND, 0)
                        finish(initial.timeInMillis)
                    }.setOnCancelListener { finish(null) }
                }.setOnCancelListener { finish(null) }

                else -> showDateDialog(
                    activity, initial, minMs?.let(::dayStart), maxMs?.let(::dayEnd),
                ) { y, m, d ->
                    initial.set(y, m, d)
                    initial.set(Calendar.HOUR_OF_DAY, 0)
                    initial.set(Calendar.MINUTE, 0)
                    initial.set(Calendar.SECOND, 0)
                    initial.set(Calendar.MILLISECOND, 0)
                    finish(initial.timeInMillis)
                }.setOnCancelListener { finish(null) }
            }
        }
    }

    private fun showDateDialog(
        activity: Activity,
        initial: Calendar,
        minMs: Long?,
        maxMs: Long?,
        onSet: (year: Int, month: Int, day: Int) -> Unit,
    ): DatePickerDialog {
        val dialog = DatePickerDialog(
            activity,
            { _, y, m, d -> onSet(y, m, d) },
            initial.get(Calendar.YEAR),
            initial.get(Calendar.MONTH),
            initial.get(Calendar.DAY_OF_MONTH),
        )
        minMs?.let { dialog.datePicker.minDate = it }
        maxMs?.let { dialog.datePicker.maxDate = it }
        dialog.show()
        return dialog
    }

    private fun showTimeDialog(
        activity: Activity,
        initial: Calendar,
        is24Hour: Boolean,
        onSet: (hour: Int, minute: Int) -> Unit,
    ): TimePickerDialog {
        val dialog = TimePickerDialog(
            activity,
            { _, hour, minute -> onSet(hour, minute) },
            initial.get(Calendar.HOUR_OF_DAY),
            initial.get(Calendar.MINUTE),
            is24Hour,
        )
        dialog.show()
        return dialog
    }

    /** Read an epoch-ms option that may arrive as Int or Double from JS. */
    private fun optionalMs(options: ReadableMap?, key: String): Long? =
        options?.takeIf { it.hasKey(key) }?.getDouble(key)?.toLong()

    private fun dayStart(ms: Long): Long = Calendar.getInstance().apply {
        timeInMillis = ms
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    private fun dayEnd(ms: Long): Long = Calendar.getInstance().apply {
        timeInMillis = ms
        set(Calendar.HOUR_OF_DAY, 23)
        set(Calendar.MINUTE, 59)
        set(Calendar.SECOND, 59)
        set(Calendar.MILLISECOND, 999)
    }.timeInMillis

    private fun cancelled(): JavaOnlyMap = JavaOnlyMap().apply {
        putBoolean("cancelled", true)
    }

    private fun result(ms: Long): JavaOnlyMap = JavaOnlyMap().apply {
        putBoolean("cancelled", false)
        putDouble("value", ms.toDouble())
    }
}
