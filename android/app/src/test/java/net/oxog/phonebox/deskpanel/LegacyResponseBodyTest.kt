package net.oxog.phonebox.deskpanel

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LegacyResponseBodyTest {
    @Test
    fun disconnectsOnceAtEndOfBody() {
        var disconnects = 0
        val source = LegacyResponseBody(ByteArrayInputStream(byteArrayOf(42))) { disconnects++ }
        val buffer = ByteArray(8)
        assertEquals(1, source.read(buffer))
        assertEquals(0, disconnects)
        assertEquals(-1, source.read(buffer))
        assertEquals(-1, source.read())
        source.close()
        assertEquals(1, disconnects)
    }

    @Test
    fun releasesConnectionOnReadFailure() {
        var disconnects = 0
        val source = LegacyResponseBody(object : InputStream() {
            override fun read(): Int = throw IOException("connection closed")
        }) { disconnects++ }
        assertThrows(IOException::class.java) { source.read() }
        assertEquals(1, disconnects)
    }
}
