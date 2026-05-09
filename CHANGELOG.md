# Change Log

All notable changes to the "zce" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.4]

- Added **Copy Location** command (`zce.copyLocation`).
- Copies the current file's relative path and line number to the clipboard.
- Available via editor context menu and keyboard shortcut `Ctrl+Shift+C` / `Cmd+Shift+C`.

## [0.0.3]

- Internal refactor: introduced `ExtensionModule` interface for a modular architecture.

## [0.0.1]

- Initial release.
- Added Explorer folder submenu with dotnet restore/build/clean/test.
- Added upward `.csproj` discovery for command execution folder.
