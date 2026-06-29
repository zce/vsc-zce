import * as vscode from 'vscode';
import { commentsToMarkdown } from './markdownExport';
import { ReviewStorage } from './storage';

export async function copyFileCommentsForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<void> {
	const threads = await storage.loadForFile(relativePath);
	if (threads.length === 0) {
		void vscode.window.showWarningMessage(`No review comments for ${relativePath}.`);
		return;
	}

	const markdown = commentsToMarkdown(threads);
	await vscode.env.clipboard.writeText(markdown);
	void vscode.window.showInformationMessage(
		`Copied ${threads.length} comment${threads.length === 1 ? '' : 's'} from ${relativePath} as Markdown.`,
	);
}

export async function resolveFileCommentsForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<number> {
	const count = await storage.resolveAllInFile(relativePath);
	if (count === 0) {
		void vscode.window.showInformationMessage(`No open comments to resolve in ${relativePath}.`);
		return 0;
	}

	void vscode.window.showInformationMessage(
		`Resolved ${count} comment${count === 1 ? '' : 's'} in ${relativePath}.`,
	);
	return count;
}

export async function deleteFileCommentsForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<boolean> {
	const threads = await storage.loadForFile(relativePath);
	if (threads.length === 0) {
		void vscode.window.showInformationMessage(`No comments to delete in ${relativePath}.`);
		return false;
	}

	const confirm = await vscode.window.showWarningMessage(
		`Delete all ${threads.length} review comment${threads.length === 1 ? '' : 's'} in ${relativePath}?`,
		{ modal: true },
		'Delete All',
	);
	if (confirm !== 'Delete All') {
		return false;
	}

	await storage.deleteAllInFile(relativePath);
	void vscode.window.showInformationMessage(`Deleted all comments in ${relativePath}.`);
	return true;
}
