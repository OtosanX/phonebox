#if WINDOWS
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace PhoneBox.Agent;

internal static class WindowsStartAppIcons
{
    private static readonly Guid AppsFolder = new("1e87508d-89c2-42f0-8a7e-645a0f50ca58");
    private static readonly Guid ImageFactory = typeof(IShellItemImageFactory).GUID;
    private static readonly ConcurrentDictionary<string, Lazy<(byte[]? Png, long Expires)>> Cache = new(StringComparer.OrdinalIgnoreCase);
    private const string AppPrefix = @"shell:AppsFolder\";
    private const string SteamPrefix = "steam://rungameid/";

    public static string? AppId(string command)
    {
        var value = command.Trim().Trim('"');
        if (!value.StartsWith(AppPrefix, StringComparison.OrdinalIgnoreCase)) return null;
        var id = value[AppPrefix.Length..].TrimStart('\\');
        return IsAppId(id) ? id : null;
    }

    private static bool IsAppId(string id)
    {
        if (id.Length is 0 or > 260 || id is "." or "..") return false;
        if (id.StartsWith(SteamPrefix, StringComparison.OrdinalIgnoreCase))
            return id.Length > SteamPrefix.Length && id[SteamPrefix.Length..].All(char.IsAsciiDigit);
        return id.All(character => char.IsLetterOrDigit(character) || character is '.' or '_' or '-' or '!' or '{' or '}' or ' ');
    }

    public static void Clear() => Cache.Clear();

    public static byte[]? Read(string appId)
    {
        if (!IsAppId(appId)) return null;
        if (Cache.TryGetValue(appId, out var existing))
        {
            var cached = existing.Value;
            if (cached.Expires > Environment.TickCount64) return cached.Png;
            Cache.TryRemove(new KeyValuePair<string, Lazy<(byte[]? Png, long Expires)>>(appId, existing));
        }
        if (Cache.Count >= 256) Cache.Clear();
        return Cache.GetOrAdd(appId, id => new Lazy<(byte[]?, long)>(() =>
        {
            var png = Extract(id);
            return (png, Environment.TickCount64 + (png is null ? 30_000 : 300_000));
        })).Value.Png;
    }

    private static byte[]? Extract(string appId)
    {
        IShellItemImageFactory? factory = null;
        nint bitmap = 0;
        try
        {
            var result = SHCreateItemInKnownFolder(in AppsFolder, 0, appId, in ImageFactory, out factory);
            if (result < 0 || factory is null) return null;
            const uint iconOnly = 0x04;
            if (factory.GetImage(new Size(64, 64), iconOnly, out bitmap) < 0 || bitmap == 0) return null;
            using var image = Image.FromHbitmap(bitmap);
            using var output = new MemoryStream();
            image.Save(output, ImageFormat.Png);
            return output.ToArray();
        }
        catch (Exception ex) when (ex is ExternalException or ArgumentException or InvalidCastException) { return null; }
        finally
        {
            if (bitmap != 0) DeleteObject(bitmap);
            if (factory is not null) Marshal.ReleaseComObject(factory);
        }
    }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig]
        int GetImage(Size size, uint flags, out nint bitmap);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHCreateItemInKnownFolder(in Guid folder, uint flags, string item,
        in Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory? factory);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(nint handle);
}
#endif
