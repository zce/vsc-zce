import * as vscode from 'vscode';
import { notesToMarkdown } from './markdownExport';
import { ReviewStorage } from './storage';

export async function copyFileNotesForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<void> {
	const notes = await storage.loadForFile(relativePath);
	if (notes.length === 0) {
		void vscode.window.showWarningMessage(`No review notes for ${relativePath}.`);
		return;
	}

	const markdown = notesToMarkdown(notes);
	await vscode.env.clipboard.writeText(markdown);
	void vscode.window.showInformationMessage(
		`Copied ${notes.length} note${notes.length === 1 ? '' : 's'} from ${relativePath} as Markdown.`,
	);
}

export async function resolveFileNotesForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<number> {
	const count = await storage.resolveAllInFile(relativePath);
	if (count === 0) {
		void vscode.window.showInformationMessage(`No open notes to resolve in ${relativePath}.`);
		return 0;
	}

	void vscode.window.showInformationMessage(
		`Resolved ${count} note${count === 1 ? '' : 's'} in ${relativePath}.`,
	);
	return count;
}

export async function deleteFileNotesForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<boolean> {
	const notes = await storage.loadForFile(relativePath);
	if (notes.length === 0) {
		void vscode.window.showInformationMessage(`No notes to delete in ${relativePath}.`);
		return false;
	}

	const confirm = await vscode.window.showWarningMessage(
		`Delete all ${notes.length} review note${notes.length === 1 ? '' : 's'} in ${relativePath}?`,
		{ modal: true },
		'Delete All',
	);
	if (confirm !== 'Delete All') {
		return false;
	}

	await storage.deleteAllInFile(relativePath);
	void vscode.window.showInformationMessage(`Deleted all notes in ${relativePath}.`);
	return true;
}
