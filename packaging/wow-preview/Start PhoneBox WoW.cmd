@echo off
setlocal
set "PROFILE_DIR=%LOCALAPPDATA%\PhoneBoxWoW"
if not exist "%PROFILE_DIR%\." mkdir "%PROFILE_DIR%"
if not exist "%PROFILE_DIR%\profile.json" copy "%~dp0starter-profile.json" "%PROFILE_DIR%\profile.json" >nul
if not exist "%PROFILE_DIR%\profile.json" (
    echo Could not create the PhoneBox WoW profile.
    pause
    exit /b 1
)
start "" "%~dp0PhoneBoxAgent.exe" --config "%PROFILE_DIR%\profile.json"
