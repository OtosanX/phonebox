package net.oxog.phonebox.deskpanel

import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper

internal enum class BatteryWarning { PLUG_IN, UNPLUG }

internal fun batteryWarning(current: BatteryWarning?, percent: Int, plugged: Boolean, low: Int, high: Int): BatteryWarning? =
    when {
        !plugged && (current == BatteryWarning.PLUG_IN || percent <= low) -> BatteryWarning.PLUG_IN
        plugged && (current == BatteryWarning.UNPLUG || percent >= high) -> BatteryWarning.UNPLUG
        else -> null
    }

internal class BatteryReminder(
    private val activity: Activity,
    private val dialogContext: () -> Context,
    private val restoreFullscreen: () -> Unit
) {
    private data class Limits(val enabled: Boolean, val low: Int, val high: Int, val autoDismiss: Boolean)

    private val preferences = activity.getSharedPreferences("battery-reminder", Context.MODE_PRIVATE)
    private var limits = Limits(preferences.getBoolean("enabled", false),
        preferences.getInt("low", 35), preferences.getInt("high", 95), preferences.getBoolean("autoDismiss", false))
    private var warning = BatteryWarning.entries.firstOrNull { it.name == preferences.getString("warning", null) }
    private var dialog: AlertDialog? = null
    private val timer = Handler(Looper.getMainLooper())
    private var timedDismissed = preferences.getBoolean("timedDismissed", false)
    private val hideReminder = Runnable {
        timedDismissed = true
        preferences.edit().putBoolean("timedDismissed", true).apply()
        dismissDialog()
    }
    private var reading: Intent? = null
    private var listening = false
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (listening && intent.action == Intent.ACTION_BATTERY_CHANGED) {
                reading = intent
                update()
            }
        }
    }

    fun start() {
        if (listening) return
        listening = true
        // This sticky broadcast is sent only by Android. No companion or network connection is needed.
        reading = activity.registerReceiver(receiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        update()
    }

    fun stop() {
        if (!listening) return
        listening = false
        activity.unregisterReceiver(receiver)
        reading = null
        dismissDialog()
    }

    fun configure(enabled: Boolean, low: Int, high: Int, autoDismiss: Boolean) {
        if (low !in 5..95 || high !in (low + 5)..100) return
        val next = Limits(enabled, low, high, autoDismiss)
        if (next == limits) return
        val modeChanged = next.autoDismiss != limits.autoDismiss
        limits = next
        if (modeChanged) timedDismissed = false
        preferences.edit().putBoolean("enabled", enabled).putInt("low", low).putInt("high", high)
            .putBoolean("autoDismiss", autoDismiss).putBoolean("timedDismissed", timedDismissed).apply()
        if (modeChanged) {
            timer.removeCallbacks(hideReminder)
            if (autoDismiss && dialog != null) timer.postDelayed(hideReminder, 3000)
        }
        update()
    }

    private fun dismissDialog() {
        timer.removeCallbacks(hideReminder)
        dialog?.dismiss()
        dialog = null
    }

    private fun update() {
        if (!limits.enabled) {
            show(null)
            return
        }
        val battery = reading ?: return
        val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val source = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
        if (level < 0 || scale <= 0 || source < 0) return
        val percent = (level * 100 / scale).coerceIn(0, 100)
        show(batteryWarning(warning, percent, source != 0, limits.low, limits.high), percent)
    }

    private fun show(next: BatteryWarning?, percent: Int = 0) {
        if (next != warning) {
            warning = next
            timedDismissed = false
            preferences.edit().putString("warning", next?.name).putBoolean("timedDismissed", false).apply()
            dismissDialog()
        }
        if (next == null || !listening || activity.isFinishing || activity.isDestroyed || limits.autoDismiss && timedDismissed) return
        val context = dialogContext()
        val message = context.getString(
            if (next == BatteryWarning.PLUG_IN) R.string.battery_reminder_low else R.string.battery_reminder_high, percent)
        dialog?.let { it.setMessage(message); return }
        dialog = AlertDialog.Builder(activity)
            .setTitle(context.getString(if (next == BatteryWarning.PLUG_IN) R.string.battery_reminder_plug else R.string.battery_reminder_unplug))
            .setMessage(message)
            .setCancelable(false)
            .setOnDismissListener { if (listening) restoreFullscreen() }
            .show()
        if (limits.autoDismiss) timer.postDelayed(hideReminder, 3000)
    }
}
