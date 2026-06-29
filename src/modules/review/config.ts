import * as path from 'node:path';
import * as vscode from 'vscode';

export const DEFAULT_STORAGE_PATH = '.vscode/zce-review.json';
export const REVIEW_CONFIG_SECTION = 'zce.review';

export function getStoragePathForFolder(workspaceFolder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace
		.getConfiguration(REVIEW_CONFIG_SECTION)
		.get<string>('storagePath', DEFAULT_STORAGE_PATH)
		.trim();

	if (!configured) {
		return path.join(workspaceFolder.uri.fsPath, DEFAULT_STORAGE_PATH);
	}

	if (path.isAbsolute(configured)) {
		return configured;
	}

	return path.join(workspaceFolder.uri.fsPath, configured);
}

export function getStorageWatcherPattern(
	workspaceFolder: vscode.WorkspaceFolder,
): vscode.RelativePattern {
	const storagePath = getStoragePathForFolder(workspaceFolder);
	return new vscode.RelativePattern(
		vscode.Uri.file(path.dirname(storagePath)),
		path.basename(storagePath),
	);
}

export function isReviewStorageUri(uri: vscode.Uri): boolean {
	if (uri.scheme !== 'file') {
		return false;
	}

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		if (uri.fsPath === getStoragePathForFolder(folder)) {
			return true;
		}
	}

	return false;
}
