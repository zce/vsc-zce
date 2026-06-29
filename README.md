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

### Review Notes

Add inline review notes to your code and manage them in the built-in **Comments** panel.

- **Add Note**: Right-click in the editor → **Add Note**, then type in the comment thread
- **Thread actions**: Copy as Markdown, Resolve / Unresolve, Delete
- **File actions** (editor or Explorer context menu): Copy File as Markdown, Resolve All Notes in File, Delete All Notes in File
- **Copy All as Markdown**: Export every note in the workspace

Notes are stored in `.vscode/ai-review.json` by default. Change the path with `zce.review.storagePath`.

When you edit a file, note positions are tracked automatically so storage stays aligned with the code.

Markdown export format:

```markdown
## src/foo.ts:42

Review comment here.

---

## src/bar.ts:10-15

Another note.
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `zce.review.storagePath` | `.vscode/ai-review.json` | Path to the review notes JSON file. Relative paths are resolved from the workspace folder root. |

## Requirements

- .NET SDK installed and available in PATH (for .NET commands).
- Local file system folders only.

## Release Notes

### 0.0.5

- Added **Review Notes** module with VS Code Comment API integration.
- Notes persist to configurable JSON storage (`zce.review.storagePath`).
- Copy notes as Markdown (single thread, single file, or entire workspace).
- Resolve and delete notes at thread or file level.
- Automatic range tracking keeps stored note positions in sync when code moves.

### 0.0.4

- Added **Copy Location** command (`zce.copyLocation`) with editor context menu and keyboard shortcut.

### 0.0.3

- Internal refactor: modular architecture with `ExtensionModule` interface.

### 0.0.1

- Initial release.
- Added Explorer folder submenu with dotnet restore/build/clean/test.
- Added upward `.csproj` discovery for command execution folder.
