import * as path from 'node:path';
import * as vscode from 'vscode';

export const DEFAULT_STORAGE_PATH = '.vscode/ai-review.json';
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
