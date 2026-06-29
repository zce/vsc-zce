# Change Log

All notable changes to the "zce" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.6]

- Renamed **Review Notes** to **Review Comments**; default storage file is `.vscode/zce-review.json`.
- Thread replies: users can add follow-ups in the editor (`User` in JSON, **You** in UI); agents reply via `replies` in JSON.
- **Edit** / **Save** / **Cancel** in comment edit mode; **Resolve / Unresolve** unchanged.
- Automated Marketplace publish on version bump in `package.json` (push to `main`).

## [0.0.5]

- Added **Review Notes** module powered by the VS Code Comment API.
- Add notes from the editor context menu; manage threads in the Comments panel.
- Persist notes to `.vscode/zce-review.json` (configurable via `zce.review.storagePath`).
- Copy notes as Markdown at thread, file, or workspace scope.
- Resolve and delete notes per thread or per file.
- Track note ranges on document edits so storage stays aligned with moved code.

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
