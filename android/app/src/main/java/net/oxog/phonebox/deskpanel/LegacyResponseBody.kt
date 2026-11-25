package net.oxog.phonebox.deskpanel

import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean

internal class LegacyResponseBody(source: InputStream, private val disconnect: () -> Unit) : FilterInputStream(source) {
    private val closed = AtomicBoolean()

    override fun read(): Int = readAndRelease { super.read() }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        return readAndRelease { super.read(buffer, offset, length) }
    }

    private inline fun readAndRelease(readFromSource: () -> Int): Int {
        if (closed.get()) return -1
        try {
            return readFromSource().also { if (it < 0) close() }
        } catch (error: IOException) {
            try { close() } catch (_: IOException) {}
            throw error
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        try { super.close() } finally { disconnect() }
    }
}
