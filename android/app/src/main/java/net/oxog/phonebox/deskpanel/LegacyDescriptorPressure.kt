package net.oxog.phonebox.deskpanel

import android.os.SystemClock
import android.util.Log
import java.io.File
import java.util.concurrent.atomic.AtomicLong

internal object LegacyDescriptorPressure {
    private const val CHECK_INTERVAL_MS = 10_000L
    private const val CLEANUP_INTERVAL_MS = 30_000L
    private const val CLEANUP_THRESHOLD = 320
    private val descriptors = File("/proc/self/fd")
    private val nextCheck = AtomicLong()

    fun check() {
        val now = SystemClock.elapsedRealtime()
        val due = nextCheck.get()
        if (now < due || !nextCheck.compareAndSet(due, now + CHECK_INTERVAL_MS)) return
        val open = descriptors.list()?.size ?: return
        if (open < CLEANUP_THRESHOLD) return
        nextCheck.compareAndSet(now + CHECK_INTERVAL_MS, now + CLEANUP_INTERVAL_MS)
        Log.i("PhoneBox", "Releasing legacy Android resources at $open open descriptors")
        System.gc()
        System.runFinalization()
    }
}
