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

private const val SNOOZE_MILLIS = 15 * 60 * 1000L

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
    private var muted = preferences.getBoolean("muted", false)
    private var snoozeUntil = preferences.getLong("snoozeUntil", 0L)
    private val endSnooze = Runnable { update() }
    private val hideReminder = Runnable {
        timedDismissed = true
        preferences.edit().putBoolean("timedDismissed", true).apply()
        dismissDialog()
    }
    private var reading: Intent? = null
    private var checkThresholds = true
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
        checkThresholds = true
        // This sticky broadcast is sent only by Android. No companion or network connection is needed.
        reading = activity.registerReceiver(receiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        update()
    }

    fun stop() {
        if (!listening) return
        listening = false
        activity.unregisterReceiver(receiver)
        reading = null
        timer.removeCallbacks(endSnooze)
        dismissDialog()
    }

    fun configure(enabled: Boolean, low: Int, high: Int, autoDismiss: Boolean) {
        if (low !in 5..95 || high !in (low + 5)..100) return
        val next = Limits(enabled, low, high, autoDismiss)
        if (next == limits) return
        val modeChanged = next.autoDismiss != limits.autoDismiss
        checkThresholds = checkThresholds || low != limits.low || high != limits.high
        if (!enabled) muted = false
        limits = next
        if (modeChanged) timedDismissed = false
        preferences.edit().putBoolean("enabled", enabled).putInt("low", low).putInt("high", high)
            .putBoolean("autoDismiss", autoDismiss).putBoolean("timedDismissed", timedDismissed)
            .putBoolean("muted", muted).apply()
        if (modeChanged) dismissDialog()
        update()
    }

    private fun dismissDialog() {
        timer.removeCallbacks(hideReminder)
        dialog?.dismiss()
        dialog = null
    }

    private fun update() {
        if (!limits.enabled || muted) {
            show(null)
            return
        }
        val battery = reading ?: return
        val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val source = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
        if (level < 0 || scale <= 0 || source < 0) return
        val percent = (level * 100 / scale).coerceIn(0, 100)
        val current = if (checkThresholds) null else warning
        checkThresholds = false
        show(batteryWarning(current, percent, source != 0, limits.low, limits.high), percent)
    }

    private fun show(next: BatteryWarning?, percent: Int = 0) {
        if (next != warning) {
            warning = next
            timedDismissed = false
            snoozeUntil = 0L
            preferences.edit().putString("warning", next?.name).putBoolean("timedDismissed", false)
                .remove("snoozeUntil").apply()
            dismissDialog()
        }
        timer.removeCallbacks(endSnooze)
        if (next == null || !listening || activity.isFinishing || activity.isDestroyed || limits.autoDismiss && timedDismissed) return
        val remaining = snoozeUntil - System.currentTimeMillis()
        if (remaining > 0) {
            timer.postDelayed(endSnooze, remaining)
            return
        }
        val context = dialogContext()
        val messageId = if (next == BatteryWarning.PLUG_IN) R.string.battery_reminder_low_brief else R.string.battery_reminder_high_brief
        val message = context.getString(messageId, percent)
        dialog?.let { it.setMessage(message); return }
        dialog = AlertDialog.Builder(activity)
            .setTitle(context.getString(if (next == BatteryWarning.PLUG_IN) R.string.battery_reminder_plug else R.string.battery_reminder_unplug))
            .setMessage(message)
            .setCancelable(false)
            .setPositiveButton(context.getString(R.string.battery_reminder_snooze)) { _, _ ->
                snoozeUntil = System.currentTimeMillis() + SNOOZE_MILLIS
                preferences.edit().putLong("snoozeUntil", snoozeUntil).apply()
                dismissDialog()
                checkThresholds = true
                timer.postDelayed(endSnooze, SNOOZE_MILLIS)
            }
            .setNeutralButton(context.getString(R.string.battery_reminder_mute)) { _, _ ->
                muted = true
                preferences.edit().putBoolean("muted", true).apply()
                update()
            }
            .setOnDismissListener { if (listening) restoreFullscreen() }
            .show()
        if (limits.autoDismiss) timer.postDelayed(hideReminder, 3000)
    }
}
