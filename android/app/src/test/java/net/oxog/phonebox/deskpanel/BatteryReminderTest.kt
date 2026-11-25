package net.oxog.phonebox.deskpanel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BatteryReminderTest {
    @Test fun lowWarningWaitsForPowerEvenIfReadingRises() {
        assertNull(batteryWarning(null, 36, false, 35, 95))
        val warning = batteryWarning(null, 35, false, 35, 95)
        assertEquals(BatteryWarning.PLUG_IN, warning)
        assertEquals(warning, batteryWarning(warning, 40, false, 35, 95))
        assertNull(batteryWarning(warning, 35, true, 35, 95))
    }

    @Test fun highWarningWaitsForUnplugEvenIfReadingFalls() {
        assertNull(batteryWarning(null, 94, true, 35, 95))
        val warning = batteryWarning(null, 95, true, 35, 95)
        assertEquals(BatteryWarning.UNPLUG, warning)
        assertEquals(warning, batteryWarning(warning, 90, true, 35, 95))
        assertNull(batteryWarning(warning, 95, false, 35, 95))
    }
}
