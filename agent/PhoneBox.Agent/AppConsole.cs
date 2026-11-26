using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace PhoneBox.Agent;

/// <summary>App console: keys and dial bindings for one app, chosen by the process name of the focused window.</summary>
public sealed class ConsoleConfig
{
    public List<ConsoleProfile> Profiles { get; set; } = [];
}

public sealed class ConsoleProfile
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    /// <summary>Process names the profile is for, comma-separated ("photoshop, gimp-2.10"); ".exe" may be left out.</summary>
    public string Apps { get; set; } = "";
    public List<ConsoleKey> Keys { get; set; } = [];
    public string? DialLeft { get; set; }
    public string? DialRight { get; set; }
    public string? DialPress { get; set; }

    public const int MaxKeys = 17;

    public IEnumerable<string> AppNames() => Apps.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(a => a.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? a[..^4] : a).Where(a => a.Length > 0);

    public bool Matches(string process) => AppNames().Any(a => string.Equals(a, process, StringComparison.OrdinalIgnoreCase));

    /// <summary>The key spec behind a numbered slot or dial action, or null.</summary>
    public string? Spec(string slot) => slot switch
    {
        "dial-left" => DialLeft,
        "dial-right" => DialRight,
        "dial-press" => DialPress,
        _ => Key(slot)?.Keys,
    };

    internal ConsoleKey? Key(string slot) =>
        slot is ['k', .. var n] && int.TryParse(n, NumberStyles.None, null, out var i)
        && i < Keys.Count && n == i.ToString(CultureInfo.InvariantCulture) ? Keys[i] : null;
}

public sealed class ConsoleKey
{
    public string Label { get; set; } = "";
    public string Keys { get; set; } = "";
    public string? Icon { get; set; }
    public string? WowSpell { get; set; }
    public int? WowIcon { get; set; }
    public int? WowOpenForm { get; set; }
    public bool? UseWowIcon { get; set; }
}

/// <summary>
/// The focused window's process name, whether it runs elevated (Windows doesn't let us type into it then), and the
/// window itself, checked once more right before the keys go out.
/// </summary>
public sealed record FocusedApp(string Process, bool Elevated, nint Window = 0, int ProcessId = 0);

/// <summary>
/// Follows the focused app and sends a profile's keys to it. Off unless an enabled page of the phone shows an
/// app-console widget with "control" on, and only for that widget; the phone sends a profile id and a slot, never keys; the focused app is
/// checked again right before every combo, so keys never land in an app the profile isn't for.
/// </summary>
public sealed class AppConsole(ConfigStore config, ILogger<AppConsole> log)
{
    /// <summary>Only Windows can say which app is focused without extra permissions or tools.</summary>
    internal bool Supported { get; set; } = OperatingSystem.IsWindows();

    internal Func<FocusedApp?> Focused { get; set; } = FocusedNow;
    internal Func<nint> ForegroundWindow { get; set; } = ForegroundNow;
    internal Func<List<string>, bool> SendCombo { get; set; } = KeySender.SendCombo;
    internal bool AgentElevated { get; set; } = Environment.IsPrivilegedProcess;

    private readonly SemaphoreSlim _sending = new(1, 1);

    /// <summary>
    /// The app console widget the phone names, as "pageId/widgetId" ("pageId/stackId:cardId" in a Smart Stack), if it is
    /// on an enabled page this phone shows. Each widget's own "control" option counts, not another one's.
    /// </summary>
    public static WidgetConfig? WidgetFor(AgentConfig c, string? deviceId, string? key) => PanelWidgets.Find(c, deviceId, key, "app-console");

    private static bool AllowsProfile(WidgetConfig w, string id) =>
        w.Str("editProfile") == id || FolderFor(w, id) is not null;

    private static JsonElement? FolderFor(WidgetConfig w, string id)
    {
        if (w.Opt("folders") is not { ValueKind: JsonValueKind.Array } folders) return null;
        foreach (var item in folders.EnumerateArray())
            if (item.ValueKind == JsonValueKind.Object && item.TryGetProperty("id", out var entry)
                && entry.ValueKind == JsonValueKind.String && entry.GetString() == id) return item;
        return null;
    }

    private static bool ForegroundKeypad(WidgetConfig w, string id) =>
        FolderFor(w, id) is { } folder
        && folder.TryGetProperty("layout", out var layout) && layout.ValueKind == JsonValueKind.String && layout.GetString() == "numpad"
        && folder.TryGetProperty("allApps", out var allApps) && allApps.ValueKind == JsonValueKind.True;

    private static int? FormFor(WidgetConfig w, string id) =>
        FolderFor(w, id) is { } folder && folder.TryGetProperty("form", out var value)
        && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var form) ? form : null;

    private static WowSpell? FormExit(WowSpellList? book, WidgetConfig w, string? folder) =>
        folder is not null && FormFor(w, folder) is { } form
            ? book?.Spells.FirstOrDefault(action => action.IsFormExit && action.Forms?.Contains(form) == true) : null;

    private static string? InventoryKind(WidgetConfig w, string? folder) =>
        folder is not null && FolderFor(w, folder) is { } entry && FolderText(entry, "role") == "wow-inventory"
            && FolderText(entry, "category") is ("food" or "potion" or "pet" or "hunter-pet") and var category ? category : null;

    internal static bool InventoryMatches(WowSpellList book, WowSpell action, string category) => category switch
    {
        "pet" => action.Kind == "pet" && action.Id.StartsWith("COMPANION:", StringComparison.Ordinal),
        "hunter-pet" => book.ClassId == "HUNTER" && action.Kind == "pet" && action.Id.StartsWith("PET:", StringComparison.Ordinal),
        _ => action.Kind == category,
    };

    private static WowSpell? InventoryAction(WowSpellList? book, WidgetConfig w, string folder, string? item) =>
        item is not null && book is not null && InventoryKind(w, folder) is { } kind
            ? book.Spells.FirstOrDefault(action => action.Id == item && InventoryMatches(book, action, kind)) : null;

    internal static void AddHunterPetFolders(AgentConfig config)
    {
        foreach (var widget in config.Pages.SelectMany(page => page.Widgets ?? []).Where(widget => widget.Type == "app-console"))
        {
            if (widget.Opt("folders") is not { ValueKind: JsonValueKind.Array } folders) continue;
            var entries = folders.EnumerateArray().ToList();
            foreach (var entry in folders.EnumerateArray())
            {
                if (FolderText(entry, "id") is not { } id || FolderText(entry, "parent") is not { } parent
                    || InventoryKind(widget, id) != "pet" || entries.Any(other => FolderText(other, "parent") == parent
                        && FolderText(other, "category") == "hunter-pet")) continue;
                var profile = config.Console.Profiles.FirstOrDefault(profile => profile.Id == id);
                if (profile is null || !WowSpellbook.Supports(profile)) continue;
                var hunterId = id + "-hunter";
                if (!config.Console.Profiles.Any(profile => profile.Id == hunterId))
                {
                    if (config.Console.Profiles.Count >= MaxProfiles) continue;
                    config.Console.Profiles.Add(new() { Id = hunterId, Label = "Hunter Pet", Apps = profile.Apps });
                }
                entries.Add(JsonSerializer.SerializeToElement(new
                {
                    id = hunterId, parent, label = "Hunter Pet", icon = "🐺", role = "wow-inventory", category = "hunter-pet",
                }));
            }
            if (entries.Count != folders.GetArrayLength()) widget.Set("folders", entries);
        }
    }

    private static string? FolderText(JsonElement entry, string key) =>
        entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

    private static (WidgetConfig Widget, ConsoleProfile Profile, JsonElement Folders)? ActionPicker(
        AgentConfig c, string? deviceId, string? widget, string? folder)
    {
        if (folder is null || EditableProfile(c, deviceId, widget, folder) is not { } profile
            || !WowSpellbook.Supports(profile) || WidgetFor(c, deviceId, widget) is not { } w
            || FolderFor(w, folder) is not { } selected || FolderText(selected, "role") != "wow-actions"
            || w.Opt("folders") is not { ValueKind: JsonValueKind.Array } folders) return null;
        return (w, profile, folders);
    }

    private static IEnumerable<(ConsoleProfile Profile, int Form)> ActionPickerProfiles(
        AgentConfig c, WidgetConfig w, ConsoleProfile parent, JsonElement folders)
    {
        yield return (parent, 0);
        foreach (var entry in folders.EnumerateArray())
        {
            if (FolderText(entry, "parent") == parent.Id && FolderText(entry, "id") is { } id
                && FormFor(w, id) is > 0 and var form
                && c.Console.Profiles.FirstOrDefault(p => p.Id == id) is { } profile && WowSpellbook.Supports(profile))
                yield return (profile, form);
        }
    }

    private static string CatalogVersion(WowSpellList book) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            JsonSerializer.SerializeToUtf8Bytes(new { book.Character, book.ClassName, book.Spells, book.Forms })));

    public (int Status, object Body) ActionSelection(string? deviceId, string? widget, string? folder)
    {
        var version = config.VersionText;
        var c = config.Get();
        if (ActionPicker(c, deviceId, widget, folder) is not { } picker)
            return (403, new { error = "Action picking is off for this folder" });
        var (book, error) = WowSpellbook.Read();
        if (book is null) return (409, new { error });
        var checkedIds = ActionPickerProfiles(c, picker.Widget, picker.Profile, picker.Folders)
            .SelectMany(x => x.Profile.Keys).Select(key => key.WowSpell).ToHashSet(StringComparer.Ordinal);
        return (200, new
        {
            book.Character, book.ClassName, book.Unavailable, book.Forms, version, catalog = CatalogVersion(book),
            actions = book.Spells.Where(action => action.IsSelectable).Select(action => new
            {
                action.Name, kind = action.Id.StartsWith("TRINKET:", StringComparison.Ordinal) ? "trinket"
                    : action.Kind is "food" or "potion" ? "item" : action.Kind,
                category = action.PickerCategory, action.Icon, action.Forms, selected = checkedIds.Contains(action.Id),
            }),
        });
    }

    public (int Status, object Body) SaveActionSelection(string? deviceId, string? widget, string? folder,
        long? version, string? catalog, string? selection)
    {
        static (int, object) Error(int status, string message) => (status, new { error = message });
        if (version is null || config.Version != version) return Error(409, "Buttons changed. Reopen Choose actions to refresh.");
        var copy = JsonSerializer.Deserialize<AgentConfig>(JsonSerializer.Serialize(config.Get(), ConfigStore.WriteOpts), ConfigStore.WriteOpts)!;
        if (ActionPicker(copy, deviceId, widget, folder) is not { } picker)
            return Error(403, "Action picking is off for this folder");
        var (book, error) = WowSpellbook.Read();
        if (book is null) return Error(409, error ?? "WoW actions unavailable");
        if (catalog != CatalogVersion(book)) return Error(409, "The WoW action list changed. Reopen Choose actions to refresh.");
        var selectable = book.Spells.Where(action => action.IsSelectable).ToArray();
        if (selection is null || selection.Length != selectable.Length || selection.Any(value => value is not ('0' or '1')))
            return Error(400, "Invalid action selection");

        var profiles = ActionPickerProfiles(copy, picker.Widget, picker.Profile, picker.Folders).ToList();
        var catalogIds = selectable.Select(action => action.Id).ToHashSet(StringComparer.Ordinal);
        var previous = profiles.SelectMany(target => target.Profile.Keys).Where(key => key.WowSpell is not null)
            .ToLookup(key => key.WowSpell!, StringComparer.Ordinal);
        var selected = selectable.Where((_, index) => selection[index] == '1').ToArray();
        var folders = picker.Folders.EnumerateArray().ToList();
        foreach (var form in selected.SelectMany(action => action.Forms ?? []).Distinct())
        {
            if (profiles.Any(target => target.Form == form)) continue;
            if (copy.Console.Profiles.Count >= MaxProfiles) return Error(400, "This deck is limited to 30 folders.");
            var title = book.Forms[form];
            var label = title.EndsWith(" Spells", StringComparison.OrdinalIgnoreCase) ? title
                : title.Length <= 17 ? title + " Spells" : "In " + title;
            if (label.Length > 24) label = label[..24];
            var profile = new ConsoleProfile { Id = $"folder-{Guid.NewGuid():N}", Label = label, Apps = picker.Profile.Apps };
            copy.Console.Profiles.Add(profile);
            profiles.Add((profile, form));
            folders.Add(JsonSerializer.SerializeToElement(new { id = profile.Id, label, parent = picker.Profile.Id, form,
                icon = form == 30 ? "🌑" : "⚡" }));
        }

        foreach (var (profile, form) in profiles)
        {
            var desired = selected.Where(action => form == 0 ? action.Forms is null : action.Forms?.Contains(form) == true)
                .ToDictionary(action => action.Id, StringComparer.Ordinal);
            var keys = new List<ConsoleKey>();
            foreach (var key in profile.Keys)
            {
                if (key.WowSpell is null || !catalogIds.Contains(key.WowSpell)) keys.Add(key);
                else if (desired.Remove(key.WowSpell, out var action)) keys.Add(LinkAction(action, key));
            }
            foreach (var action in desired.Values) keys.Add(LinkAction(action, previous[action.Id].FirstOrDefault()));
            if (keys.Count > ConsoleProfile.MaxKeys) return Error(400, $"Choose up to {ConsoleProfile.MaxKeys} buttons for {profile.Label}.");
            profile.Keys = keys;
        }

        picker.Widget.Set("folders", folders);
        var err = config.Save(JsonSerializer.Serialize(copy, ConfigStore.WriteOpts), version);
        return err is null ? (200, new { folders }) : Error(err == ConfigStore.Conflict ? 409 : 400, err);
    }

    private static ConsoleKey LinkAction(WowSpell action, ConsoleKey? existing) => new()
    {
        Label = existing?.Label ?? action.Name, Icon = existing?.Icon ?? "✨", WowSpell = action.Id,
        WowIcon = action.Icon > 0 ? action.Icon : null,
        WowOpenForm = action.OpensForm > 0 ? action.OpensForm : null,
        UseWowIcon = existing?.UseWowIcon,
    };

    private static bool IsKeypadPress(List<List<string>> combos) =>
        combos is [[var key]] && (key == "numlock" || key.StartsWith("numpad", StringComparison.Ordinal));

    private static bool IsKeypadBinding(string spec)
    {
        if (string.IsNullOrWhiteSpace(spec)) return false;
        try { return IsKeypadPress(KeySender.Parse(spec)); }
        catch (ArgumentException) { return false; }
    }

    private static ConsoleProfile? EditableProfile(AgentConfig c, string? deviceId, string? widget, string? folder)
    {
        var w = WidgetFor(c, deviceId, widget);
        var id = folder ?? w?.Str("editProfile");
        return w?.Bool("control") == true && w.Str("editProfile") is { Length: > 0 } && id is { Length: > 0 }
            && AllowsProfile(w, id) ? c.Console.Profiles.FirstOrDefault(p => p.Id == id) : null;
    }

    public (int Status, object Body) Bindings(string? deviceId, string? widget, string? folder = null)
    {
        var version = config.VersionText;
        var c = config.Get();
        var profile = EditableProfile(c, deviceId, widget, folder);
        return profile is null ? (403, new { error = "Button editing is off for this widget" })
            : (200, new { profile.Label, version, profile.Keys, maxKeys = ConsoleProfile.MaxKeys,
                spellPicker = WowSpellbook.Supports(profile) && folder is not null
                    && WidgetFor(c, deviceId, widget) is { } w && !ForegroundKeypad(w, folder),
                wowIcons = folder is not null && WowSpellbook.Supports(profile)
                    && WidgetFor(c, deviceId, widget)?.Str("editProfile") == folder });
    }

    public bool CanPickSpells(string? deviceId, string? widget, string? folder)
    {
        var c = config.Get();
        return folder is not null && EditableProfile(c, deviceId, widget, folder) is { } profile
            && WowSpellbook.Supports(profile) && WidgetFor(c, deviceId, widget) is { } w && !ForegroundKeypad(w, folder);
    }

    public (int Status, object Body) EditBinding(string? deviceId, string? widget, int? index, string? label, string? keys, long? version, string? icon = null, string? folder = null, string? wowSpell = null, bool? useWowIcon = null)
    {
        static (int, object) Error(int status, string error) => (status, new { error });
        if (version is null || index is null or < 0 || label is null || keys is null)
            return Error(400, "Choose a button and give it a name and keybind");
        label = label.Trim();
        keys = keys.Trim();
        var linkedSpell = !string.IsNullOrEmpty(wowSpell);
        if (label.Length == 0 || label.Length > (linkedSpell ? 120 : 24) || keys.Length > MaxSpec || icon?.Length > 12)
            return Error(400, "Enter a button name and an optional keybind");
        try
        {
            if (keys.Length > 0 && KeySender.Parse(keys).Count != 1)
                return Error(400, "Enter one keybind, such as Shift+1");
        }
        catch (ArgumentException ex) { return Error(400, ex.Message); }
        if (config.Version != version) return Error(409, ConfigStore.Conflict);
        var snapshot = JsonSerializer.Serialize(config.Get(), ConfigStore.WriteOpts);
        var copy = JsonSerializer.Deserialize<AgentConfig>(snapshot, ConfigStore.WriteOpts)!;
        var profile = EditableProfile(copy, deviceId, widget, folder);
        if (profile is null) return Error(403, "Button editing is off for this widget");
        if (index.Value > profile.Keys.Count || index.Value >= ConsoleProfile.MaxKeys)
            return Error(404, "That button slot is unavailable");
        WowSpell? action = null;
        if (!string.IsNullOrEmpty(wowSpell))
        {
            if (!WowSpellbook.Supports(profile) || folder is null
                || WidgetFor(copy, deviceId, widget) is not { } w || ForegroundKeypad(w, folder))
                return Error(403, "Spell picking is unavailable for this folder");
            if (WowSpellbook.Read().Book?.Spells.FirstOrDefault(candidate => !candidate.IsFormExit && candidate.Id == wowSpell) is not { } spell)
                return Error(409, "That spell is missing from the synced spellbook");
            action = spell;
            var form = FormFor(w, folder);
            if (spell.Forms?.Contains(form ?? 0) != true && (form is not null || spell.Forms is not null))
                return Error(400, "Choose this action in its form or stance folder");
            keys = "";
        }
        var binding = new ConsoleKey { Label = label, Keys = keys, Icon = string.IsNullOrWhiteSpace(icon) ? null : icon,
            WowSpell = action?.Id, WowIcon = action is { Icon: > 0 } ? action.Icon : null,
            WowOpenForm = action is { OpensForm: > 0 } ? action.OpensForm : null,
            UseWowIcon = useWowIcon ?? profile.Keys.ElementAtOrDefault(index.Value)?.UseWowIcon };
        if (index.Value == profile.Keys.Count) profile.Keys.Add(binding);
        else profile.Keys[index.Value] = binding;
        var err = config.Save(JsonSerializer.Serialize(copy, ConfigStore.WriteOpts), version, out var savedVersion);
        if (err is not null) return Error(err == ConfigStore.Conflict ? 409 : 400, err);
        return (200, new { version = savedVersion.ToString(CultureInfo.InvariantCulture) });
    }

    public (int Status, object Body) AddFolder(string? deviceId, string? widget, string? label)
    {
        label = label?.Trim();
        if (label is null || label.Length is 0 or > 24) return (400, new { error = "Give the folder a name" });
        var version = config.Version;
        var copy = JsonSerializer.Deserialize<AgentConfig>(JsonSerializer.Serialize(config.Get(), ConfigStore.WriteOpts), ConfigStore.WriteOpts)!;
        if (EditableProfile(copy, deviceId, widget, null) is not { } parent || WidgetFor(copy, deviceId, widget) is not { } w
            || w.Opt("folders") is not { ValueKind: JsonValueKind.Array } folders)
            return (403, new { error = "Folder editing is off for this widget" });
        var id = $"folder-{Guid.NewGuid():N}";
        var folder = new { id, label, icon = "📁" };
        copy.Console.Profiles.Add(new() { Id = id, Label = label, Apps = parent.Apps });
        w.Set("folders", folders.EnumerateArray().Append(JsonSerializer.SerializeToElement(folder)).ToArray());
        var err = config.Save(JsonSerializer.Serialize(copy, ConfigStore.WriteOpts), version);
        return err is null ? (200, folder) : (err == ConfigStore.Conflict ? 409 : 400, new { error = err });
    }

    /// <summary>What the phone may know: the matching profile's id, label and key labels. Never the process name or title.</summary>
    public (int Status, object Body) State(string? deviceId, string? widget, string? folder = null)
    {
        var c = config.Get();
        if (WidgetFor(c, deviceId, widget) is not { } w) return (404, new { error = "this app console widget isn't on an enabled page of this phone" });
        var control = w.Bool("control") == true;
        if (!Supported) return (200, new { supported = false, control, profile = (object?)null });
        var app = Focused();
        var profile = folder is null
            ? app is null ? null : c.Console.Profiles.FirstOrDefault(p => p.Matches(app.Process))
            : EditableProfile(c, deviceId, widget, folder);
        var keypad = folder is not null && ForegroundKeypad(w, folder);
        var matches = app is not null && profile?.Matches(app.Process) == true;
        var elevated = app is { Elevated: true } && !AgentElevated;
        var spells = profile is not null && WowSpellbook.Supports(profile) ? WowSpellbook.Read().Book : null;
        var actions = spells?.Spells.ToDictionary(x => x.Id, StringComparer.Ordinal);
        var inventoryKind = InventoryKind(w, folder);
        var inventory = inventoryKind is not null && spells is not null
            ? spells.Spells.Where(a => InventoryMatches(spells, a, inventoryKind)).OrderBy(a => a.Name, StringComparer.CurrentCultureIgnoreCase).ToArray()
            : [];
        var shown = inventoryKind is null ? profile?.Keys ?? [] : inventory.Select(a => LinkAction(a, null)).ToList();
        var exit = FormExit(spells, w, folder);
        var showRogueExit = folder is not null && FormFor(w, folder) == 30
            && profile?.Keys.Any(key => key.WowSpell?.StartsWith("ROGUE:", StringComparison.Ordinal) == true) == true;
        var form = folder is null ? null : FormFor(w, folder);
        var druid = actions?.Keys.Any(id => id.StartsWith("DRUID:", StringComparison.Ordinal)) == true;
        var stealthed = matches && control && folder is not null && app is not null && spells?.ProcessId == app.ProcessId
            && (druid || actions?.Keys.Any(id => id.StartsWith("ROGUE:", StringComparison.Ordinal)) == true)
            && FolderFor(w, folder) is { } entry && (FolderText(entry, "role") == "wow-actions" || form == 30 || druid && form == 1)
            ? WowStealth.Read(app.Window) : null;
        return (200, new
        {
            supported = true,
            control,
            focused = app is not null && (matches || keypad),
            elevated,
            keypad,
            stealthed,
            hunter = spells?.ClassId == "HUNTER",
            inventory = inventoryKind is not null,
            formExit = exit is null && !showRogueExit ? null : new
            {
                name = exit?.Name ?? "Leave Stealth", icon = exit?.Icon ?? 132320, opensForm = exit?.OpensForm ?? 0,
                available = exit is not null && matches && spells?.ProcessId == app?.ProcessId,
                needsSync = exit is null,
            },
            profile = profile is null ? null : new
            {
                profile.Id,
                profile.Label,
                keys = shown.Select(k => k.Label),
                inventoryIds = inventory.Select(a => a.Id),
                queueIds = shown.Select(k => k.WowSpell is { } id
                    && actions?.GetValueOrDefault(id)?.Kind == "spell" ? id : null),
                icons = shown.Select(k => k.Icon),
                iconIds = shown.Select(k => k.UseWowIcon == false ? 0 : k.WowSpell is { } spell
                    ? actions?.GetValueOrDefault(spell)?.Icon ?? k.WowIcon ?? 0
                    : folder == w.Str("editProfile") ? spells?.BarIcons.GetValueOrDefault(k.Keys) ?? 0 : 0),
                opensForm = shown.Select(k => k.WowSpell is { } spell
                    ? actions?.GetValueOrDefault(spell)?.OpensForm is > 0 and var opens ? opens
                        : k.WowOpenForm ?? (spell == "ROGUE:Stealth" ? 30 : 0) : 0),
                bound = shown.Select(k => k.WowSpell is not null || !string.IsNullOrWhiteSpace(k.Keys)),
                available = shown.Select(k => k.WowSpell is not null
                    ? matches && spells is not null && spells.ProcessId == app?.ProcessId && spells.Spells.Any(spell => spell.Id == k.WowSpell)
                    : matches || keypad && IsKeypadBinding(k.Keys)),
                dial = new { left = profile.DialLeft is not null, right = profile.DialRight is not null, press = profile.DialPress is not null },
            },
        });
    }

    /// <summary>Presses a slot of a profile. <paramref name="times"/> repeats a dial turn (clamped to 1..5).</summary>
    public async Task<(int Status, string? Error)> Act(string? deviceId, string? widget, string profileId, string slot, int times,
        CancellationToken ct, string? queuedSpell = null, string? inventoryItem = null)
    {
        var c = config.Get();
        if (WidgetFor(c, deviceId, widget) is not { } w || w.Bool("control") != true
            || w.Opt("folders") is not null && !AllowsProfile(w, profileId))
            return (403, "sending keys is off: turn on \"Send keys to the computer\" in the app console widget's settings");
        if (!Supported) return (409, "the app console needs Windows");
        var profile = c.Console.Profiles.FirstOrDefault(p => p.Id == profileId);
        if (profile is null) return (404, "no such profile");
        var leaveForm = slot == "leave-form";
        var useInventory = slot == "inventory";
        var wowSpell = profile.Key(slot)?.WowSpell;
        var book = wowSpell is null && !leaveForm && !useInventory ? null : WowSpellbook.Read().Book;
        if (queuedSpell is not null && (leaveForm || queuedSpell != wowSpell
            || book?.Spells.Any(spell => spell.Id == queuedSpell && spell.Kind == "spell") != true))
            return (409, "That queued spell changed. Remove it and add it again.");
        if (leaveForm)
        {
            if (!WowSpellbook.Supports(profile) || FormExit(book, w, profileId) is not { } exit)
                return (409, "The form exit is unavailable. Sync in WoW with /pbspells.");
            wowSpell = exit.Id;
        }
        if (useInventory)
        {
            if (!WowSpellbook.Supports(profile) || InventoryAction(book, w, profileId, inventoryItem) is not { } item)
                return (409, "That action is unavailable. Run /pbspells in WoW to refresh.");
            wowSpell = item.Id;
        }
        var spec = wowSpell is null ? profile.Spec(slot) : book?.Spells.FirstOrDefault(spell => spell.Id == wowSpell)?.Shortcut;
        if (wowSpell is not null && (!WowSpellbook.Supports(profile) || book is null || spec is null))
            return (409, "That spell is unavailable. Sync in WoW with /pbspells.");
        if (string.IsNullOrWhiteSpace(spec)) return (404, "nothing is set for this key");
        List<List<string>> combos;
        try { combos = KeySender.Parse(spec); }
        catch (ArgumentException ex) { return (400, ex.Message); }
        // also for a binding saved before the limit, or written into the file by hand
        if (combos.Count > MaxCombos) return (400, $"more than {MaxCombos} key presses; shorten this binding in the app console settings");
        times = slot is "dial-left" or "dial-right" ? Math.Clamp(times, 1, 5) : 1;
        var anyApp = slot.StartsWith('k') && ForegroundKeypad(w, profileId) && IsKeypadPress(combos);
        var keypadTarget = anyApp ? Focused() : null;

        if (!await _sending.WaitAsync(TimeSpan.FromSeconds(2), ct)) return (429, "still sending the previous keys");
        try
        {
            for (var t = 0; t < times; t++)
                foreach (var combo in combos)
                {
                    // checked again before every combo: a click elsewhere mid-macro must not send the rest there.
                    // Looked up first, so a binding saved while this runs is still seen by the checks below.
                    var app = Focused();
                    // the switch can be turned off (or the widget removed) while this waits or runs
                    var current = config.Get();
                    if (WidgetFor(current, deviceId, widget) is not { } currentWidget || currentWidget.Bool("control") != true
                        || currentWidget.Opt("folders") is not null && !AllowsProfile(currentWidget, profileId))
                        return (403, "sending keys was turned off");
                    var currentProfile = current.Console.Profiles.FirstOrDefault(p => p.Id == profileId);
                    if (currentProfile is null || (leaveForm
                        ? FormExit(WowSpellbook.Read().Book, currentWidget, profileId)?.Id != wowSpell
                        : useInventory ? InventoryAction(WowSpellbook.Read().Book, currentWidget, profileId, inventoryItem)?.Id != wowSpell
                        : currentProfile.Key(slot)?.WowSpell != wowSpell || (wowSpell is null && currentProfile.Spec(slot) != spec)))
                        return (409, "the app console binding changed");
                    // the app the macro started for, as the profile named it then and names it now: a profile moved to
                    // another app mid-macro doesn't take the rest of the keys with it
                    if (app is null) return (409, "no Windows app is in front");
                    if (anyApp)
                    {
                        if (!ForegroundKeypad(currentWidget, profileId) || keypadTarget != app)
                            return (409, "the focused app changed");
                    }
                    else if (!profile.Matches(app.Process) || !currentProfile.Matches(app.Process))
                        return (409, "the focused app changed");
                    if (wowSpell is not null && (app.ProcessId != book?.ProcessId || !WowSpellbook.Supports(currentProfile)
                        || WowSpellbook.Read().Book?.Spells.FirstOrDefault(spell => spell.Id == wowSpell)?.Shortcut != spec))
                        return (409, "the synced WoW spell changed");
                    if (app.Elevated && !AgentElevated) return (409, "the focused app runs as administrator, so Windows doesn't let the agent send keys to it");
                    // the checks above take a moment: the same window must still be in front as the keys go out
                    if (app.Window != 0 && ForegroundWindow() != app.Window) return (409, "the focused app changed");
                    if (queuedSpell is not null && FormFor(currentWidget, profileId) == 30 && WowStealth.Read(app.Window) != true)
                        return (409, "Enter Stealth before sending this spell.");
                    ct.ThrowIfCancellationRequested();
                    if (!SendCombo(combo)) return (500, "Windows refused the key press");
                    if (combos.Count > 1 || times > 1) await Task.Delay(40, ct);
                }
            return (200, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning("app console {Profile}/{Slot}: {Msg}", profileId, slot, ex.Message);
            return (500, "the keys could not be sent");
        }
        finally { _sending.Release(); }
    }

    // MaxCombos: 20 presses x 5 dial clicks x 40 ms plus the 2 s queue wait stay well inside the phone's 20 s deadline
    internal const int MaxApps = 300, MaxSpec = 200, MaxProfiles = 30, MaxCombos = 20;

    /// <summary>Checks a profile's key specs; null when they are all valid.</summary>
    public static string? Validate(ConsoleProfile p)
    {
        if (!p.AppNames().Any()) return $"App console profile '{p.Label}' has no app";
        // refused rather than cut short: a shortened list or combo could still be valid and match or press something else
        if (p.Apps.Length > MaxApps) return $"App console profile '{p.Label}': the app list is longer than {MaxApps} characters";
        if (p.Keys.Count > ConsoleProfile.MaxKeys) return $"App console profile '{p.Label}' has more than {ConsoleProfile.MaxKeys} keys";
        if (p.Keys.Any(k => k.WowSpell is not null && (!WowSpellbook.Supports(p)
            || k.WowSpell.Length is < 3 or > 150 || k.WowSpell.Any(char.IsControl) || !string.IsNullOrWhiteSpace(k.Keys))))
            return $"App console profile '{p.Label}' has an invalid WoW spell";
        foreach (var (spec, what) in p.Keys.Select((k, i) => ((string?)k.Keys, $"key {i + 1}")).Append((p.DialLeft, "dial left")).Append((p.DialRight, "dial right")).Append((p.DialPress, "dial press")))
        {
            if (string.IsNullOrWhiteSpace(spec)) continue;
            if (spec.Length > MaxSpec) return $"App console profile '{p.Label}', {what}: longer than {MaxSpec} characters";
            try { if (KeySender.Parse(spec).Count > MaxCombos) return $"App console profile '{p.Label}', {what}: more than {MaxCombos} key presses"; }
            catch (ArgumentException ex) { return $"App console profile '{p.Label}', {what}: {ex.Message}"; }
        }
        return null;
    }

    private static nint ForegroundNow()
    {
#if WINDOWS
        return GetForegroundWindow();
#else
        return 0;
#endif
    }

    internal static FocusedApp? FocusedNow()
    {
#if WINDOWS
        var hwnd = GetForegroundWindow();
        if (hwnd == 0) return null;
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0) return null;
        try
        {
            using var p = Process.GetProcessById((int)pid);
            return new FocusedApp(p.ProcessName, Elevated(pid), hwnd, p.Id);
        }
        catch (ArgumentException) { return null; } // gone
        catch (InvalidOperationException) { return null; }
#else
        return null;
#endif
    }

#if WINDOWS
    /// <summary>True when the process runs elevated, or when its token can't even be read (which is how an elevated one looks from here).</summary>
    private static bool Elevated(uint pid)
    {
        var process = OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
        if (process == 0) return true;
        try
        {
            if (!OpenProcessToken(process, 0x0008 /* TOKEN_QUERY */, out var token)) return true;
            try { return !GetTokenInformation(token, 20 /* TokenElevation */, out var elevated, sizeof(int), out _) || elevated != 0; }
            finally { CloseHandle(token); }
        }
        finally { CloseHandle(process); }
    }

    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern nint OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint pid);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(nint process, uint access, out nint token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetTokenInformation(nint token, int infoClass, out int info, int length, out int returned);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(nint handle);
#endif
}
