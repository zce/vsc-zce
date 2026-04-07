import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

export class UpwardFolderLocator {
	async findNearestFolderContaining(
		startFolder: vscode.Uri,
		matcher: (entryName: string) => boolean,
	): Promise<vscode.Uri | undefined> {
		let currentPath = startFolder.fsPath;

		while (true) {
			if (await this.hasMatchingEntry(currentPath, matcher)) {
				return vscode.Uri.file(currentPath);
			}

			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) {
				return undefined;
			}

			currentPath = parentPath;
		}
	}

	private async hasMatchingEntry(
		folderPath: string,
		matcher: (entryName: string) => boolean,
	): Promise<boolean> {
		try {
			const entries = await fs.readdir(folderPath);
			return entries.some(matcher);
		} catch {
			return false;
		}
	}
}
