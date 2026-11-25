using System.IO.Compression;
using Microsoft.Extensions.Caching.Memory;

namespace PhoneBox.Agent;

internal sealed class WowIcons : IDisposable
{
    private readonly HttpClient _http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(6) };
    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 256 });
    private static readonly Lazy<Dictionary<int, string>> Names = new(ReadIndex);

    internal async Task<byte[]?> Get(int id, CancellationToken ct)
    {
        if (!Names.Value.TryGetValue(id, out var name)) return null;
        if (_cache.TryGetValue(id, out byte[]? cached)) return cached;
        byte[]? image = null;
        try
        {
            using var response = await _http.GetAsync($"https://render.worldofwarcraft.com/us/icons/56/{name}.jpg",
                HttpCompletionOption.ResponseHeadersRead, ct);
            if (response.IsSuccessStatusCode && response.Content.Headers.ContentType?.MediaType == "image/jpeg"
                && response.Content.Headers.ContentLength is > 0 and <= 32_768)
                image = await response.Content.ReadAsByteArrayAsync(ct);
        }
        catch (HttpRequestException) { }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
        _cache.Set(id, image, new MemoryCacheEntryOptions
        {
            Size = 1,
            AbsoluteExpirationRelativeToNow = image is null ? TimeSpan.FromMinutes(2) : TimeSpan.FromHours(12),
        });
        return image;
    }

    private static Dictionary<int, string> ReadIndex()
    {
        // Interface/Icons entries from the WoW Forever 1.60.1.71037 ManifestInterfaceData table on wago.tools.
        using var resource = typeof(WowIcons).Assembly.GetManifestResourceStream("wow-icon-index.csv.gz")!;
        using var compressed = new GZipStream(resource, CompressionMode.Decompress);
        using var file = new StreamReader(compressed);
        var names = new Dictionary<int, string>();
        while (file.ReadLine() is { } line)
        {
            var split = line.IndexOf(';');
            if (split > 0 && int.TryParse(line.AsSpan(0, split), out var id)) names.TryAdd(id, line[(split + 1)..]);
        }
        return names;
    }

    public void Dispose()
    {
        _http.Dispose();
        _cache.Dispose();
    }
}
