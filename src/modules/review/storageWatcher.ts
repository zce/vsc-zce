import * as vscode from 'vscode';
import { getStorageWatcherPattern } from './config';

const RELOAD_DELAY_MS = 300;

export function registerStorageWatchers(
	onExternalChange: (workspaceFolder: vscode.WorkspaceFolder) => void,
): { reattach: () => void; dispose: () => void } {
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const watchers: vscode.FileSystemWatcher[] = [];

	const dispose = (): void => {
		for (const timer of timers.values()) {
			clearTimeout(timer);
		}
		timers.clear();

		for (const watcher of watchers) {
			watcher.dispose();
		}
		watchers.length = 0;
	};

	const scheduleReload = (folder: vscode.WorkspaceFolder): void => {
		const key = folder.uri.toString();
		const existing = timers.get(key);
		if (existing) {
			clearTimeout(existing);
		}

		timers.set(
			key,
			setTimeout(() => {
				timers.delete(key);
				onExternalChange(folder);
			}, RELOAD_DELAY_MS),
		);
	};

	const attachWatchers = (): void => {
		for (const watcher of watchers) {
			watcher.dispose();
		}
		watchers.length = 0;

		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const watcher = vscode.workspace.createFileSystemWatcher(
				getStorageWatcherPattern(folder),
			);

			const reload = () => scheduleReload(folder);
			watcher.onDidChange(reload);
			watcher.onDidCreate(reload);
			watcher.onDidDelete(reload);
			watchers.push(watcher);
		}
	};

	attachWatchers();

	return { reattach: attachWatchers, dispose };
}
