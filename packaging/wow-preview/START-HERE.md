# PhoneBox Spellbook 1.2.1 and PhoneBox Deck 1.2.2 preview

The add-on targets World of Warcraft Forever 1.60.1. This preview uses a Windows 11 x64 PC and an Android touchscreen. The Vizio XR6M10 running Android 6.0.1 was the reference device for the full interface.

## Install the add-on and companion

1. Extract `PhoneBoxSpellbook-1.2.1.zip` into World of Warcraft’s `_forever_/Interface/AddOns/` folder. The game should find `AddOns/PhoneBoxSpellbook/PhoneBoxSpellbook.toc`. Restart the game if it was running.
2. Install the **x64 .NET Desktop Runtime 10** and **x64 ASP.NET Core Runtime 10** from [Microsoft’s .NET 10 downloads](https://dotnet.microsoft.com/download/dotnet/10.0). Extract the Windows companion and double-click **Start PhoneBox WoW.cmd**. If you already have a PhoneBox agent open, exit it first so this instance can use port 8765. The launcher starts with a separate profile under `%LOCALAPPDATA%\PhoneBoxWoW`.
3. Install the signed `PhoneBox-WoW-Android-1.2.2-preview.apk` on the Android device and open PhoneBox. This preview is signed separately from upstream builds. If Android reports a signature conflict with your existing PhoneBox, use a spare device or back up your pairing information and settings before replacing the existing install.
4. For USB, enable **USB debugging**, use a data cable and accept the device’s authorization prompt. Install [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) and place its `platform-tools` folder in `%LOCALAPPDATA%\Android\Sdk`, or set the full `adb.exe` path in PhoneBox’s settings. You can also use `winget install -e --id Google.PlatformTools`. The PC agent handles USB forwarding after that.
5. Log in to WoW and type `/pbspells` outside combat. This reloads the UI and saves the action list. Keep the game running at the same Windows privilege level as PhoneBox.
6. Open `http://127.0.0.1:8765` in your PC browser. Open your deck’s **WoW Actions** folder and choose the skills, items or macros you want. Return focus to WoW before using the touchscreen. Refresh with `/pbspells` after substantial spellbook or inventory changes.

**Action Bar** sends the default main bar keys, which you can edit on layouts that use different bindings. **Adventure** groups the detected Hearthstone, fishing setup, food, potions, and Pet Journal companions. Hunters also get **Hunter Pet** for active combat-pet commands. After collecting a new companion or calling a hunter pet, use `/pbspells` outside combat to sync. Game icons are loaded when available. WoW still handles range, targets, cooldowns and form restrictions. With more than one synced WoW account on the same installation, the current build disables spellbook controls until it can identify a single export.

Automatic upstream updates start off so the preview stays compatible with the add-on. Use these companion files as a matched set.

**Pets** shows up to eight companions at a time. Tap **Previous** or **Next** to move between pages, or tap a companion to summon it. A paw icon appears when game art is unavailable.

On a personal phone, open PhoneBox from the app launcher. Android Back or **All pages → Close app** takes you out of the deck. For a dedicated tablet, turn on **Settings → Display → Kiosk → Open PhoneBox when the phone is plugged in** if wanted.

## Upload to CurseForge

- Create a World of Warcraft **AddOns** project named **PhoneBox Spellbook**. Use **Action Bars** if offered.
- Upload `PhoneBox-Spellbook-icon.png` as the project icon and paste the text from `CurseForge-listing.md` into the listing.
- Upload `PhoneBoxSpellbook-1.2.1.zip` as the add-on file. Select **WoW Forever 1.60.1** and mark the file as a beta while collecting feedback.
- Host the Windows ZIP, Android APK and setup instructions on the [PhoneBox Deck GitHub fork](https://github.com/OtosanX/phonebox). Use the CurseForge project’s **Source** field to link that fork. Keep the companion binaries outside the CurseForge add-on upload.
- `SHA256SUMS.txt` gives the checksums for the upload files.

[CurseForge submission guide](https://support.curseforge.com/support/solutions/articles/9000199552-overview-of-the-project-submission-page) · [Original PhoneBox project](https://github.com/ersinkoc/phonebox)
