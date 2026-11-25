namespace PhoneBox.Agent;

/// <summary>Reads only the add-on's visible corner indicator and discards the sampled region.</summary>
internal static class WowStealth
{
    internal static bool? Read(nint window)
    {
#if WINDOWS
        if (window == 0 || GetForegroundWindow() != window || !GetClientRect(window, out var rect)
            || rect.Right < 64 || rect.Bottom < 28) return null;
        var origin = new Point();
        if (!ClientToScreen(window, ref origin)) return null;
        try
        {
            using var sample = new System.Drawing.Bitmap(64, 28, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using var graphics = System.Drawing.Graphics.FromImage(sample);
            graphics.CopyFromScreen(origin.X, origin.Y, 0, 0, sample.Size);
            if (GetForegroundWindow() != window) return null;
            return Decode((x, y) => sample.GetPixel(x, y).ToArgb());
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or ArgumentException)
        {
            return null;
        }
#else
        return null;
#endif
    }

    internal static bool? Decode(Func<int, int, int> pixel)
    {
        for (var y = 1; y < 24; y += 2)
        for (var x = 1; x < 24; x += 2)
        {
            if (!Near(pixel(x, y), 15, 209, 245)) continue;
            for (var width = 5; width <= 16; width++)
            {
                if (!Near(pixel(x + width, y), 199, 26, 227)) continue;
                var active = Near(pixel(x + width * 2, y), 38, 240, 61);
                var idle = Near(pixel(x + width * 2, y), 250, 115, 26);
                if (!active && !idle) continue;
                if (!Near(pixel(x, y + 2), 15, 209, 245)
                    || !Near(pixel(x + width, y + 2), 199, 26, 227)) continue;
                if (active && Near(pixel(x + width * 2, y + 2), 38, 240, 61)) return true;
                if (idle && Near(pixel(x + width * 2, y + 2), 250, 115, 26)) return false;
            }
        }
        return null;
    }

    private static bool Near(int argb, int red, int green, int blue) =>
        Math.Abs(((argb >> 16) & 255) - red) <= 29 &&
        Math.Abs(((argb >> 8) & 255) - green) <= 29 &&
        Math.Abs((argb & 255) - blue) <= 29;

#if WINDOWS
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct Point { public int X, Y; }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool ClientToScreen(nint window, ref Point point);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool GetClientRect(nint window, out Rect rect);
#endif
}
