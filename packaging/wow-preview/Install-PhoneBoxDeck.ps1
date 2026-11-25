param(
    [ValidateSet('Off', 'UntilCableChanges', 'ThreeSeconds')][string] $BatteryReminders,
    [ValidateRange(1024, 65535)][int] $Port = 8765,
    [switch] $NoBrowser
)

$ErrorActionPreference = 'Stop'
$payload = Join-Path $PSScriptRoot 'app'
$starterProfile = Join-Path $PSScriptRoot 'starter-profile.json'
$sourceAgent = Join-Path $payload 'PhoneBoxAgent.exe'
if (!(Test-Path -LiteralPath $sourceAgent -PathType Leaf) -or !(Test-Path -LiteralPath $starterProfile -PathType Leaf)) {
    throw 'Extract the entire PhoneBox Deck ZIP before running Install PhoneBox Deck.cmd.'
}

$profileDirectory = Join-Path $env:LOCALAPPDATA 'PhoneBoxWoW'
$profile = Join-Path $profileDirectory 'profile.json'
$appsDirectory = Join-Path $env:LOCALAPPDATA 'PhoneBoxDeck\app'
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'setup-version.txt') -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'The setup package is missing its version.' }
$app = Join-Path $appsDirectory $version
$agent = Join-Path $app 'PhoneBoxAgent.exe'
$settings = "http://127.0.0.1:$Port"

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $existing = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($existing.Path -ne $agent) {
        throw 'Exit the running PhoneBox from the Windows system tray, then run setup again.'
    }
}

if (!(Test-Path -LiteralPath $profile -PathType Leaf)) {
    if (!$BatteryReminders) {
        Write-Host ''
        Write-Host 'Choose battery reminders on your Android device'
        Write-Host '  1. Off'
        Write-Host '  2. Stay on screen until you plug in or unplug'
        Write-Host '  3. Close after 3 seconds'
        do { $choice = Read-Host 'Enter 1, 2 or 3 [1]' } until ($choice -in '', '1', '2', '3')
        $BatteryReminders = switch ($choice) { '2' { 'UntilCableChanges' } '3' { 'ThreeSeconds' } default { 'Off' } }
    }
    $config = Get-Content -LiteralPath $starterProfile -Raw | ConvertFrom-Json
    $config.charge.reminders = $BatteryReminders -ne 'Off'
    $config.charge | Add-Member -MemberType NoteProperty -Name autoDismissReminder -Value ($BatteryReminders -eq 'ThreeSeconds') -Force
    New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
    $temporaryProfile = Join-Path $profileDirectory ("setup-" + [Guid]::NewGuid().ToString('N') + ".tmp")
    try {
        [IO.File]::WriteAllText($temporaryProfile, ($config | ConvertTo-Json -Depth 24), [Text.UTF8Encoding]::new($false))
        try { [IO.File]::Move($temporaryProfile, $profile) }
        catch [IO.IOException] { if (!(Test-Path -LiteralPath $profile -PathType Leaf)) { throw } }
    } finally {
        if (Test-Path -LiteralPath $temporaryProfile) { Remove-Item -LiteralPath $temporaryProfile }
    }
}

if (!(Test-Path -LiteralPath $agent -PathType Leaf)) {
    New-Item -ItemType Directory -Path $appsDirectory -Force | Out-Null
    $stage = Join-Path $appsDirectory (".setup-" + [Guid]::NewGuid().ToString('N'))
    try {
        Copy-Item -LiteralPath $payload -Destination $stage -Recurse
        try { [IO.Directory]::Move($stage, $app) }
        catch [IO.IOException] { if (!(Test-Path -LiteralPath $agent -PathType Leaf)) { throw } }
    } finally {
        if (Test-Path -LiteralPath $stage) {
            $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
            if ($resolvedStage.StartsWith("$appsDirectory\.setup-", [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $resolvedStage -Recurse -Force
            }
        }
    }
}

$arguments = "--config `"$profile`" --port $Port"
if (!$listener) { $process = Start-Process -FilePath $agent -ArgumentList $arguments -WorkingDirectory $app -WindowStyle Hidden -PassThru }
$ready = $false
try {
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $info = Invoke-RestMethod -Uri "$settings/api/info" -TimeoutSec 2
            if ($info.configPath -eq $profile) { $ready = $true; break }
        } catch {}
        if ($process -and $process.HasExited) { break }
        Start-Sleep -Milliseconds 400
    }
    if (!$ready) { throw 'PhoneBox Deck did not start. Close any other PhoneBox instance and try again.' }
} finally {
    if (!$ready -and $process -and !$process.HasExited) { Stop-Process -Id $process.Id }
}

$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-Item -ItemType Directory -Path $menu -Force | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $menu 'PhoneBox Deck.lnk'))
$shortcut.TargetPath = $agent
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $app
$shortcut.Save()
Write-Host 'PhoneBox Deck is installed. You can reopen it from the Start menu.'
if (!$NoBrowser) { Start-Process $settings }
