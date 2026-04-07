# zce

Personal VS Code commands for .NET folder workflows.

## Features

- Adds a folder context submenu named ZCE .NET in Explorer.
- Supports these commands on a selected folder:
	- dotnet restore
	- dotnet build
	- dotnet clean
	- dotnet test
- Resolves the execution folder by searching upward for the nearest directory that contains a `.csproj` file.
- If no `.csproj` is found upward, runs in the selected folder.

## Usage

1. In Explorer, right-click a folder.
2. Select ZCE .NET.
3. Choose the command to run.

## Requirements

- .NET SDK installed and available in PATH.
- Local file system folders (non-local resources are not supported).

## Extension Settings

This extension currently does not contribute custom settings.

## Known Issues

- Multi-root workspace behavior follows the selected folder path only.

## Release Notes

### 0.0.1

- Initial release.
- Added Explorer folder submenu with dotnet restore/build/clean/test.
- Added upward `.csproj` discovery for command execution folder.
