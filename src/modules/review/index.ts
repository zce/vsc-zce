import * as vscode from 'vscode';
import { ExtensionModule } from '../../module';
import { REVIEW_CONFIG_SECTION } from './config';
import { ReviewCommentController } from './comments';
import {
	copyFileCommentsForPath,
	deleteFileCommentsForPath,
	resolveFileCommentsForPath,
} from './fileActions';
import { commentsToMarkdown } from './markdownExport';
import { ReviewStorage } from './storage';
import { registerStorageWatchers } from './storageWatcher';
import { scheduleStartupRetries, whenWorkspaceReady } from './workspaceReady';

export class ReviewModule implements ExtensionModule {
	private readonly storage = new ReviewStorage();
	private commentController: ReviewCommentController | undefined;

	activate(context: vscode.ExtensionContext): void {
		this.commentController = new ReviewCommentController(this.storage);
		this.commentController.registerCommands(context);

		const syncComments = (options?: { external?: boolean; force?: boolean }) => {
			if (this.commentController?.isMutatingStorage()) {
				return;
			}

			void (async () => {
				if (!this.commentController?.isActivated()) {
					await this.commentController?.bootstrap();
					return;
				}

				await this.commentController.syncFromStorage(options);
			})();
		};

		const reloadFromExternalStorage = (workspaceFolder: vscode.WorkspaceFolder) => {
			if (this.commentController?.isMutatingStorage()) {
				return;
			}

			if (this.storage.shouldSuppressExternalReload(workspaceFolder)) {
				return;
			}

			this.storage.invalidateFolder(workspaceFolder);
			syncComments({ external: true });
		};

		const bootstrapReview = (revealPanel = false) => {
			void (async () => {
				await whenWorkspaceReady();
				await this.commentController?.bootstrap({ revealPanel });
			})();
		};

		const storageWatchers = registerStorageWatchers(reloadFromExternalStorage);

		context.subscriptions.push(
			this.commentController,
			this.storage.onDidChange(syncComments),
			new vscode.Disposable(() => storageWatchers.dispose()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				this.storage.clearCache();
				storageWatchers.reattach();
				bootstrapReview(true);
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(`${REVIEW_CONFIG_SECTION}.storagePath`)) {
					this.storage.clearCache();
					storageWatchers.reattach();
					bootstrapReview(true);
				}
			}),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (!this.commentController?.isActivated()) {
					return;
				}

				if (!this.commentController.hasCommentsForUri(event.document.uri)) {
					return;
				}

				this.commentController.handleDocumentChange(event);
			}),
			scheduleStartupRetries(() => bootstrapReview(true)),
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.commentController?.flushDeferredExternalSync();
			}),
			vscode.commands.registerCommand('zce.review.refresh', () => this.refreshComments()),
			vscode.commands.registerCommand('zce.review.add', () => this.addComment()),
			vscode.commands.registerCommand('zce.review.copyAsMarkdown', () =>
				this.copyAsMarkdown(),
			),
			vscode.commands.registerCommand('zce.review.copyFileAsMarkdown', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => copyFileCommentsForPath(this.storage, file)),
			),
			vscode.commands.registerCommand('zce.review.resolveFileComments', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => resolveFileCommentsForPath(this.storage, file)),
			),
			vscode.commands.registerCommand('zce.review.deleteFileComments', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => deleteFileCommentsForPath(this.storage, file)),
			),
		);
	}

	deactivate(): void {
		this.commentController?.dispose();
	}

	private async refreshComments(): Promise<void> {
		await this.storage.refreshFromDisk(false);
		await this.commentController?.syncFromStorage({ force: true });
		void vscode.window.showInformationMessage('Review comments refreshed.');
	}

	private async addComment(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			void vscode.window.showWarningMessage('No active editor.');
			return;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		if (!workspaceFolder) {
			void vscode.window.showWarningMessage('Save the file inside a workspace folder first.');
			return;
		}

		const range = this.toCommentRange(editor);
		await this.commentController?.openDraft(editor.document.uri, range);
	}

	private toCommentRange(editor: vscode.TextEditor): vscode.Range {
		const { selection, document } = editor;

		if (!selection.isEmpty) {
			return new vscode.Range(selection.start, selection.end);
		}

		const line = selection.active.line;
		const lineText = document.lineAt(line);
		return new vscode.Range(line, 0, line, lineText.text.length);
	}

	private resolveTargetUri(resource?: vscode.Uri): vscode.Uri | undefined {
		return resource ?? vscode.window.activeTextEditor?.document.uri;
	}

	private async runForFile(
		resource: vscode.Uri | undefined,
		action: (relativePath: string) => Promise<unknown>,
	): Promise<void> {
		const uri = this.resolveTargetUri(resource);
		if (!uri) {
			void vscode.window.showWarningMessage('No file selected.');
			return;
		}

		await action(this.storage.toRelativePath(uri));
	}

	private async copyAsMarkdown(): Promise<void> {
		const threads = await this.storage.loadAll();
		if (threads.length === 0) {
			void vscode.window.showWarningMessage('No comments to export.');
			return;
		}

		const markdown = commentsToMarkdown(threads);
		await vscode.env.clipboard.writeText(markdown);
		void vscode.window.showInformationMessage(
			`Copied ${threads.length} comment${threads.length === 1 ? '' : 's'} as Markdown.`,
		);
	}
}
