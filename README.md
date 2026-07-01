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

### Review Comments

Add inline review comments to your code and manage them in the built-in **Comments** panel.

- **Add Comment** / **Refresh Comments**: Editor → **ZCE Review** submenu
- **Edit**: Comment **...** menu (open threads)
- **Reply**: Add follow-up notes on an open thread (stored as `User` in JSON, shown as **You** in the UI)
- **Thread actions** (title bar): Copy as Markdown, Resolve / Unresolve, Delete
- **File actions**: **ZCE Review** submenu → Resolve All / Delete All in File; Copy File / Copy All as Markdown at the bottom

Comments are stored in `.vscode/zce-review.json` by default. Change the path with `zce.review.storagePath`.

Reply authors in JSON: **`User`** for your follow-ups, **`Agent`** (or a custom name) for agent responses. Markdown export uses the stored author names.

Use **Refresh Comments** in the **ZCE Review** submenu to reload after external edits; changes are also picked up automatically via a file watcher.

When you edit a file, comment positions are tracked automatically so storage stays aligned with the code.

Markdown export format:

```markdown
## src/foo.ts:42

Review comment here.

### User

A follow-up note.

### Agent

Agent response here.
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `zce.review.storagePath` | `.vscode/zce-review.json` | Path to the review comments JSON file. Relative paths are resolved from the workspace folder root. |

## Requirements

- .NET SDK installed and available in PATH (for .NET commands).
- Local file system folders only.

## Release Notes

### 0.0.8

- Comments panel thread context menu: Copy, Resolve/Unresolve, Delete.
- **ZCE Review** submenu: Copy/Delete unresolved or resolved; **Resolve All in File** before **Refresh**.

### 0.0.7

- External `zce-review.json` edits sync automatically; use **Refresh Comments** to reload manually.
- **ZCE Review** submenu; deferred sync while editing to keep editor focus.

### 0.0.6

- **Review Comments**: inline comments with user replies, agent replies via JSON, Edit / Resolve / Markdown export.
- Default storage: `.vscode/zce-review.json`.

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
