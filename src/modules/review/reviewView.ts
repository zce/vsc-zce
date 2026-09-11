import * as vscode from 'vscode';
import {
	copyFileCommentsForPath,
	copyFileUnresolvedCommentsForPath,
	deleteFileCommentsForPath,
	deleteResolvedFileCommentsForPath,
	resolveFileCommentsForPath,
} from './fileActions';
import { reviewRangeToRange } from './location';
import { commentsToMarkdown } from './markdownExport';
import { ReviewStorage } from './storage';
import { ReviewThread } from './types';

const VIEW_ID = 'zce.reviewView';

class ReviewFileItem extends vscode.TreeItem {
	constructor(
		readonly relativePath: string,
		readonly workspaceFolder: vscode.WorkspaceFolder,
		readonly threads: readonly ReviewThread[],
	) {
		super(relativePath, vscode.TreeItemCollapsibleState.Collapsed);

		const unresolved = threads.filter((thread) => !thread.resolved).length;
		this.contextValue = unresolved > 0 ? 'reviewFileOpen' : 'reviewFileResolved';
		this.description = `${unresolved}/${threads.length}`;
		this.iconPath = new vscode.ThemeIcon('file');
		this.tooltip = `${relativePath} · ${unresolved} unresolved / ${threads.length} total`;
	}
}

class ReviewThreadItem extends vscode.TreeItem {
	constructor(readonly thread: ReviewThread) {
		super(commentPreview(thread.body), vscode.TreeItemCollapsibleState.None);

		const startLine = thread.range.startLine + 1;
		const endLine = thread.range.endLine + 1;
		this.contextValue = thread.resolved ? 'reviewThreadResolved' : 'reviewThreadOpen';
		this.description = startLine === endLine ? `Ln ${startLine}` : `Ln ${startLine}-${endLine}`;
		this.iconPath = new vscode.ThemeIcon(thread.resolved ? 'comment' : 'comment-unresolved');
		this.tooltip = `${thread.file}:${startLine}${startLine === endLine ? '' : `-${endLine}`}\n\n${thread.body}`;
		this.command = {
			command: 'zce.review.view.openThread',
			title: 'Open Comment',
			arguments: [thread.id],
		};
	}
}

type ReviewTreeItem = ReviewFileItem | ReviewThreadItem;

function commentPreview(body: string): string {
	const firstLine = body.split(/\r?\n/, 1)[0].trim();
	if (firstLine.length <= 80) {
		return firstLine || '(empty comment)';
	}

	return `${firstLine.slice(0, 77)}...`;
}

export class ReviewTreeView implements vscode.TreeDataProvider<ReviewTreeItem>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
		ReviewTreeItem | undefined | null | void
	>();
	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	constructor(
		private readonly storage: ReviewStorage,
		private readonly afterMutation: () => Promise<void>,
	) {}

	register(context: vscode.ExtensionContext): void {
		const treeView = vscode.window.createTreeView(VIEW_ID, {
			treeDataProvider: this,
			showCollapseAll: true,
		});

		this.disposables.push(
			treeView,
			this.storage.onDidChange(() => this.refresh()),
			vscode.commands.registerCommand('zce.review.view.openThread', (value: unknown) =>
				this.openThread(this.resolveThreadId(value)),
			),
			vscode.commands.registerCommand('zce.review.view.copyThread', (value: unknown) =>
				this.copyThread(this.resolveThreadId(value)),
			),
			vscode.commands.registerCommand('zce.review.view.resolveThread', (value: unknown) =>
				this.setThreadResolved(this.resolveThreadId(value), true),
			),
			vscode.commands.registerCommand('zce.review.view.unresolveThread', (value: unknown) =>
				this.setThreadResolved(this.resolveThreadId(value), false),
			),
			vscode.commands.registerCommand('zce.review.view.deleteThread', (value: unknown) =>
				this.deleteThread(this.resolveThreadId(value)),
			),
			vscode.commands.registerCommand('zce.review.view.copyFile', (value: unknown) =>
				this.withFile(value, (file) => copyFileCommentsForPath(this.storage, file)),
			),
			vscode.commands.registerCommand('zce.review.view.copyFileUnresolved', (value: unknown) =>
				this.withFile(value, (file) => copyFileUnresolvedCommentsForPath(this.storage, file)),
			),
			vscode.commands.registerCommand('zce.review.view.resolveFile', (value: unknown) =>
				this.withFileMutation(value, (file) => resolveFileCommentsForPath(this.storage, file)),
			),
			vscode.commands.registerCommand('zce.review.view.deleteResolvedFile', (value: unknown) =>
				this.withFileMutation(value, (file) =>
					deleteResolvedFileCommentsForPath(this.storage, file),
				),
			),
			vscode.commands.registerCommand('zce.review.view.deleteFile', (value: unknown) =>
				this.withFileMutation(value, (file) => deleteFileCommentsForPath(this.storage, file)),
			),
		);

		context.subscriptions.push(this);
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.onDidChangeTreeDataEmitter.dispose();
	}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	getTreeItem(element: ReviewTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ReviewTreeItem): Promise<ReviewTreeItem[]> {
		if (element instanceof ReviewFileItem) {
			return [...element.threads]
				.sort((a, b) => a.range.startLine - b.range.startLine || a.range.startChar - b.range.startChar)
				.map((thread) => new ReviewThreadItem(thread));
		}

		if (element) {
			return [];
		}

		const threads = await this.storage.loadAll();
		const groups = new Map<string, ReviewFileItem>();

		for (const thread of threads) {
			const workspaceFolder = this.storage.resolveWorkspaceFolder(thread);
			if (!workspaceFolder) {
				continue;
			}

			const key = `${workspaceFolder.uri.toString()}\0${thread.file}`;
			const existing = groups.get(key);
			if (existing) {
				groups.set(
					key,
					new ReviewFileItem(existing.relativePath, workspaceFolder, [...existing.threads, thread]),
				);
				continue;
			}

			groups.set(key, new ReviewFileItem(thread.file, workspaceFolder, [thread]));
		}

		return [...groups.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	}

	private resolveThreadId(value: unknown): string | undefined {
		if (typeof value === 'string') {
			return value;
		}

		if (value instanceof ReviewThreadItem) {
			return value.thread.id;
		}

		return undefined;
	}

	private resolveFile(value: unknown): string | undefined {
		return value instanceof ReviewFileItem ? value.relativePath : undefined;
	}

	private async withFile(
		value: unknown,
		action: (relativePath: string) => Promise<unknown>,
	): Promise<void> {
		const file = this.resolveFile(value);
		if (!file) {
			return;
		}

		await action(file);
	}

	private async withFileMutation(
		value: unknown,
		action: (relativePath: string) => Promise<unknown>,
	): Promise<void> {
		const file = this.resolveFile(value);
		if (!file) {
			return;
		}

		await action(file);
		await this.afterMutation();
	}

	private async openThread(id: string | undefined): Promise<void> {
		if (!id) {
			return;
		}

		const thread = await this.storage.ensureThreadLoaded(id);
		if (!thread) {
			return;
		}

		const workspaceFolder = this.storage.resolveWorkspaceFolder(thread);
		if (!workspaceFolder) {
			return;
		}

		const uri = vscode.Uri.file(this.storage.toAbsolutePath(thread, workspaceFolder));
		const range = reviewRangeToRange(thread.range);

		try {
			const editor = await vscode.window.showTextDocument(uri, {
				preview: true,
				selection: range,
			});
			editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		} catch {
			void vscode.window.showWarningMessage(`Could not open ${thread.file}.`);
		}
	}

	private async copyThread(id: string | undefined): Promise<void> {
		if (!id) {
			return;
		}

		const thread = await this.storage.ensureThreadLoaded(id);
		if (!thread) {
			return;
		}

		await vscode.env.clipboard.writeText(commentsToMarkdown([thread]));
		void vscode.window.showInformationMessage('Copied comment as Markdown.');
	}

	private async setThreadResolved(id: string | undefined, resolved: boolean): Promise<void> {
		if (!id) {
			return;
		}

		const thread = await this.storage.ensureThreadLoaded(id);
		if (!thread || Boolean(thread.resolved) === resolved) {
			return;
		}

		await this.storage.updateThread({
			...thread,
			resolved,
			resolvedAt: resolved ? new Date().toISOString() : undefined,
		});
		await this.afterMutation();
	}

	private async deleteThread(id: string | undefined): Promise<void> {
		if (!id) {
			return;
		}

		const thread = await this.storage.ensureThreadLoaded(id);
		if (!thread) {
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			'Delete this comment thread permanently?',
			{ modal: true },
			'Delete',
		);
		if (confirm !== 'Delete') {
			return;
		}

		await this.storage.removeThread(thread);
		await this.afterMutation();
	}
}
