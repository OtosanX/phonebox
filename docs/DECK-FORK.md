# PhoneBox Deck fork

PhoneBox Deck builds on [PhoneBox by Ersin KOÇ](https://github.com/ersinkoc/phonebox) to turn a spare Android device into a Windows touchscreen control deck. This branch starts from upstream PhoneBox 0.9.29. The upstream [MIT license](../LICENSE) applies.

## Changes in this fork

- Independently editable portrait and landscape widget positions on each page. Rotating the device switches between them. All Pages shows a scaled layout preview for every enabled page.
- Windows Start app picker with imported shortcut icons. Configurable app buttons, folders and a full PC numpad.
- Updated media and volume widgets, with larger cover art and player-volume control where the active player exposes it. Other players can use the system volume.
- Dashboard widgets for live hardware metrics, FPS when a compatible source is available, and the next major holiday. CPU temperature depends on Windows telemetry or a compatible hardware monitor.
- Discord voice-call widget, speaking indicators and expanded Discord controls. Available controls depend on Discord’s local integration.
- Compatibility work for the Vizio XR6M10 and older Android WebViews, including sizing, touch volume, USB reconnection and an optional compact panel. USB takes priority when connected.
- Optional battery reminders that stay visible until the cable state changes. Automatic USB launching and kiosk behavior are opt-in. On a personal phone, use Android Back or **All pages → Close app**.

## WoW Forever integration

**PhoneBox Spellbook** is a separate World of Warcraft add-on prepared for CurseForge. Its add-on source lives in [extras/wow/PhoneBoxSpellbook](../extras/wow/PhoneBoxSpellbook). The PhoneBox Deck fork supplies the Windows and Android companions.

The WoW App Console includes a spell and item picker, eligible form and stealth folders, game icons, action-bar shortcuts, and Adventure menus for Hearthstone, fishing, food, potions, and collected Pet Journal companions. The Hunter Pet folder shows active combat-pet commands for Hunters. A queue lets you choose the order and execute each step with a separate tap. The Windows companion reads the add-on’s local saved export, and supported stealth states use a visible in-game indicator.

Use matching builds from this fork. The upstream installers and release files do not include these changes. See the [preview quick start](../packaging/wow-preview/START-HERE.md) for installation and pairing.
