# zce

Personal VS Code commands for daily workflows.

## Features

### Editor: Copy Location

Copy the current cursor position (file path + line number) to the clipboard. Useful for writing prompts in AI agents.

- **Shortcut**: `Ctrl+Shift+C` (Windows/Linux) / `Cmd+Shift+C` (macOS)
- **Context menu**: Right-click in any editor → **Copy Location**
- Single line: `src/extension.ts:14`
- Multi-line selection: `src/extension.ts:14-20`

### .NET Folder Commands

Adds a **ZCE .NET** submenu in the Explorer context menu for running dotnet commands on a selected folder.

- `dotnet restore`
- `dotnet build`
- `dotnet clean`
- `dotnet test`

Automatically resolves the nearest parent directory containing a `.csproj` file. Falls back to the selected folder if none is found.

## Requirements

- .NET SDK installed and available in PATH (for .NET commands).
- Local file system folders only.

## Release Notes

### 0.0.4

- Added **Copy Location** command (`zce.copyLocation`) with editor context menu and keyboard shortcut.

### 0.0.3

- Internal refactor: modular architecture with `ExtensionModule` interface.

### 0.0.1

- Initial release.
- Added Explorer folder submenu with dotnet restore/build/clean/test.
- Added upward `.csproj` discovery for command execution folder.
