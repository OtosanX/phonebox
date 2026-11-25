using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace PhoneBox.Agent;

internal sealed record WowSpell(string Id, string Name, string Shortcut, string Kind = "spell", int Icon = 0,
    int[]? Forms = null, int OpensForm = 0)
{
    internal bool IsFormExit => Id.StartsWith("EXIT:", StringComparison.Ordinal);
    internal bool IsSelectable => !IsFormExit && !Id.StartsWith("ADVENTURE:", StringComparison.Ordinal);
}

internal sealed record WowSpellList(string Character, string ClassName, string ClassId, List<WowSpell> Spells, int Unavailable, int ProcessId,
    Dictionary<string, int> BarIcons, Dictionary<int, string> Forms);

internal static partial class WowSpellbook
{
    private static readonly object Gate = new();
    private static (WowSpellList? Book, string? Error) _cached;
    private static long _checkedAt = -1000;
    private static readonly string[] Modifiers = ["ctrl+shift+", "ctrl+shift+alt+", "ctrl+alt+", "alt+shift+"];
    private static readonly string[] ChordKeys = ["f1", "f2", "f3", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
        .. Enumerable.Range('a', 26).Select(code => ((char)code).ToString())];

    internal static bool Supports(ConsoleProfile profile) =>
        profile.AppNames().SequenceEqual(["Wow"], StringComparer.OrdinalIgnoreCase);

    internal static (WowSpellList? Book, string? Error) Read()
    {
        lock (Gate)
        {
            var now = Environment.TickCount64;
            if (now - _checkedAt >= 1000)
            {
                _cached = ReadCurrent();
                _checkedAt = now;
            }
            return _cached;
        }
    }

    private static (WowSpellList?, string?) ReadCurrent()
    {
        const string sync = "Log into WoW Forever and type /pbspells outside combat to sync your spellbook.";
        if (!OperatingSystem.IsWindows()) return (null, sync);
        var games = Process.GetProcessesByName("Wow");
        try
        {
            if (games.Length != 1) return (null, sync);
            var game = games[0];
            var root = Path.GetDirectoryName(game.MainModule?.FileName);
            if (root is null || !Path.GetFileName(root).Equals("_forever_", StringComparison.OrdinalIgnoreCase))
                return (null, sync);
            var accounts = Path.Combine(root, "WTF", "Account");
            if (!Directory.Exists(accounts)) return (null, sync);
            var files = Directory.EnumerateDirectories(accounts)
                .Select(path => Path.Combine(path, "SavedVariables", "PhoneBoxSpellbook.lua"))
                .Where(File.Exists).ToArray();
            if (files.Length > 1) return (null, "PhoneBox detected spellbooks from multiple WoW accounts. Spell buttons are unavailable.");
            if (files.Length != 1 || File.GetLastWriteTimeUtc(files[0]) < game.StartTime.ToUniversalTime()
                || new FileInfo(files[0]).Length > 128_000) return (null, sync);
            var book = Parse(File.ReadAllText(files[0]), game.Id);
            return book is null ? (null, sync) : (book, null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return (null, sync);
        }
        finally
        {
            foreach (var game in games) game.Dispose();
        }
    }

    internal static WowSpellList? Parse(string text, int processId)
    {
        // SavedVariables is Lua source. Only extract and decode our own bounded string. Never evaluate the file.
        var match = Export().Match(text);
        if (!match.Success || match.Groups[2].Length % 2 != 0) return null;
        var legacy = match.Groups[1].Value == "2";
        var lines = Encoding.UTF8.GetString(Convert.FromHexString(match.Groups[2].Value)).Split('\n');
        if (lines.Length < 4 || !ClassId().IsMatch(lines[0]) || lines[1].Length is < 1 or > 64
            || lines[2].Length is < 1 or > 64 || !int.TryParse(lines[^1], out var unavailable) || unavailable < 0)
            return null;
        var spells = new List<WowSpell>();
        var slots = new HashSet<int>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var bar = new Dictionary<string, int>();
        var forms = new Dictionary<int, string>();
        foreach (var line in lines.Skip(3).SkipLast(1))
        {
            var fields = line.Split('\t');
            if (!legacy && fields is ["bar", var key, var texture])
            {
                if (key.Length != 1 || !"1234567890-=".Contains(key[0]) || !int.TryParse(texture, out var barIcon)
                    || barIcon <= 0 || !bar.TryAdd(key switch { "-" => "minus", "=" => "equals", _ => key }, barIcon)) return null;
                continue;
            }
            if (!legacy && fields is ["form", var formKey, var title])
            {
                if (!TryForm(formKey, out var formId) || title.Length is < 1 or > 40 || title.Any(char.IsControl)
                    || !forms.TryAdd(formId, title)) return null;
                continue;
            }
            if ((legacy ? fields.Length != 2 : fields.Length != 7) || !int.TryParse(fields[0], out var slot)
                || !slots.Add(slot) || Shortcut(slot) is not { } shortcut) return null;
            var name = legacy ? fields[1] : fields[4];
            var id = legacy ? lines[0] + ":" + name : fields[2];
            var kind = legacy ? "spell" : fields[1];
            var icon = 0;
            if (name.Length is < 1 or > 120 || name.Any(char.IsControl) || id.Length is < 3 or > 150
                || id.Any(char.IsControl) || !ids.Add(id)
                || kind is not ("spell" or "item" or "poison" or "pet" or "macro" or "food" or "potion")
                || (!legacy && (!int.TryParse(fields[3], out icon) || icon < 0))) return null;
            var required = new List<int>();
            var opens = 0;
            if (!legacy)
            {
                foreach (var value in fields[5].Split(',', StringSplitOptions.RemoveEmptyEntries))
                {
                    if (!TryForm(value, out var number) || required.Contains(number)) return null;
                    required.Add(number);
                }
                if (fields[6] != "0" && !TryForm(fields[6], out opens)) return null;
            }
            spells.Add(new WowSpell(id, name, shortcut, kind, icon, required.Count == 0 ? null : required.ToArray(), opens));
        }
        if (spells.Any(spell => (spell.OpensForm != 0 && !forms.ContainsKey(spell.OpensForm))
            || spell.Forms?.Any(id => !forms.ContainsKey(id)) == true)) return null;
        return new WowSpellList(lines[2], lines[1], lines[0], spells, unavailable, processId, bar, forms);
    }

    private static bool TryForm(string text, out int id) => int.TryParse(text, out id) && id is >= 1 and <= 64;
    private static string? Shortcut(int slot)
    {
        var index = slot - 1;
        if (index < 0 || index >= Modifiers.Length * ChordKeys.Length) return null;
        return Modifiers[index / ChordKeys.Length] + ChordKeys[index % ChordKeys.Length];
    }

    [GeneratedRegex("""(?m)^PhoneBoxSpellbookExport\s*=\s*"PB([23]):([0-9A-F]{8,80000})"\s*$""")]
    private static partial Regex Export();

    [GeneratedRegex("^[A-Z]{2,20}$")]
    private static partial Regex ClassId();

}
