using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace PhoneBox.Agent;

internal static class WindowsStartApps
{
    public static async Task<JsonElement> Read(CancellationToken cancellationToken)
    {
        var shell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
        var start = new ProcessStartInfo(shell)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            RedirectStandardOutput = true,
        };
        foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-StartApps | Sort-Object Name | Select-Object -First 2000 Name,AppID)" })
            start.ArgumentList.Add(arg);

        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start Windows PowerShell.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            var output = await process.StandardOutput.ReadToEndAsync(deadline.Token);
            await process.WaitForExitAsync(deadline.Token);
            if (process.ExitCode != 0) throw new InvalidOperationException("Windows could not list Start menu apps.");
            using var json = JsonDocument.Parse(output);
            return json.RootElement.Clone();
        }
        catch (OperationCanceledException)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            if (cancellationToken.IsCancellationRequested) throw;
            throw new TimeoutException("Windows took too long to list Start menu apps.");
        }
    }
}
