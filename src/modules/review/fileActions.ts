import * as vscode from 'vscode';
import { commentsToMarkdown } from './markdownExport';
import { ReviewStorage } from './storage';
import { ReviewThread } from './types';

function unresolvedThreads(threads: readonly ReviewThread[]): ReviewThread[] {
	return threads.filter((thread) => !thread.resolved);
}

function resolvedThreads(threads: readonly ReviewThread[]): ReviewThread[] {
	return threads.filter((thread) => thread.resolved);
}

async function copyThreadsAsMarkdown(
	threads: ReviewThread[],
	successMessage: string,
	emptyMessage: string,
): Promise<void> {
	if (threads.length === 0) {
		void vscode.window.showWarningMessage(emptyMessage);
		return;
	}

	const markdown = commentsToMarkdown(threads);
	await vscode.env.clipboard.writeText(markdown);
	void vscode.window.showInformationMessage(successMessage);
}

export async function copyAllComments(storage: ReviewStorage): Promise<void> {
	const threads = await storage.loadAll();
	await copyThreadsAsMarkdown(
		threads,
		`Copied ${threads.length} comment${threads.length === 1 ? '' : 's'}.`,
		'No comments to copy.',
	);
}

export async function copyUnresolvedComments(storage: ReviewStorage): Promise<void> {
	const threads = unresolvedThreads(await storage.loadAll());
	await copyThreadsAsMarkdown(
		threads,
		`Copied ${threads.length} unresolved comment${threads.length === 1 ? '' : 's'}.`,
		'No unresolved comments to copy.',
	);
}

export async function copyFileCommentsForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<void> {
	const threads = await storage.loadForFile(relativePath);
	await copyThreadsAsMarkdown(
		threads,
		`Copied ${threads.length} comment${threads.length === 1 ? '' : 's'} from ${relativePath}.`,
		`No comments in ${relativePath}.`,
	);
}

export async function copyFileUnresolvedCommentsForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<void> {
	const threads = unresolvedThreads(await storage.loadForFile(relativePath));
	await copyThreadsAsMarkdown(
		threads,
		`Copied ${threads.length} unresolved comment${threads.length === 1 ? '' : 's'} from ${relativePath}.`,
		`No unresolved comments in ${relativePath}.`,
	);
}

export async function deleteFileCommentsForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<boolean> {
	const threads = await storage.loadForFile(relativePath);
	if (threads.length === 0) {
		void vscode.window.showInformationMessage(`No comments in ${relativePath}.`);
		return false;
	}

	const confirm = await vscode.window.showWarningMessage(
		`Delete all ${threads.length} comment${threads.length === 1 ? '' : 's'} in ${relativePath}?`,
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

export async function deleteResolvedFileCommentsForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<boolean> {
	const threads = resolvedThreads(await storage.loadForFile(relativePath));
	if (threads.length === 0) {
		void vscode.window.showInformationMessage(`No resolved comments in ${relativePath}.`);
		return false;
	}

	const confirm = await vscode.window.showWarningMessage(
		`Delete ${threads.length} resolved comment${threads.length === 1 ? '' : 's'} in ${relativePath}?`,
		{ modal: true },
		'Delete Resolved',
	);
	if (confirm !== 'Delete Resolved') {
		return false;
	}

	await storage.deleteResolvedInFile(relativePath);
	void vscode.window.showInformationMessage(
		`Deleted ${threads.length} resolved comment${threads.length === 1 ? '' : 's'} in ${relativePath}.`,
	);
	return true;
}

export async function deleteAllResolvedComments(storage: ReviewStorage): Promise<boolean> {
	const threads = resolvedThreads(await storage.loadAll());
	if (threads.length === 0) {
		void vscode.window.showInformationMessage('No resolved comments to delete.');
		return false;
	}

	const confirm = await vscode.window.showWarningMessage(
		`Delete all ${threads.length} resolved comment${threads.length === 1 ? '' : 's'}?`,
		{ modal: true },
		'Delete Resolved',
	);
	if (confirm !== 'Delete Resolved') {
		return false;
	}

	const removed = await storage.deleteAllResolved();
	void vscode.window.showInformationMessage(
		`Deleted ${removed} resolved comment${removed === 1 ? '' : 's'}.`,
	);
	return true;
}

export async function resolveFileCommentsForPath(
	storage: ReviewStorage,
	relativePath: string,
): Promise<number> {
	const count = await storage.resolveAllInFile(relativePath);
	if (count === 0) {
		void vscode.window.showInformationMessage(`No open comments in ${relativePath}.`);
		return 0;
	}

	void vscode.window.showInformationMessage(
		`Resolved ${count} comment${count === 1 ? '' : 's'} in ${relativePath}.`,
	);
	return count;
}
