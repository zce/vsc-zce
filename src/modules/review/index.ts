import * as vscode from 'vscode';
import { ExtensionModule } from '../../module';
import { REVIEW_CONFIG_SECTION, isReviewStorageUri } from './config';
import { ReviewCommentController } from './comments';
import {
	copyAllComments,
	copyFileCommentsForPath,
	copyFileUnresolvedCommentsForPath,
	copyUnresolvedComments,
	deleteAllResolvedComments,
	deleteFileCommentsForPath,
	deleteResolvedFileCommentsForPath,
	resolveFileCommentsForPath,
} from './fileActions';
import { ReviewStorage } from './storage';
import { registerStorageWatchers } from './storageWatcher';
import { whenWorkspaceReady } from './workspaceReady';

export class ReviewModule implements ExtensionModule {
	private readonly storage = new ReviewStorage();
	private commentController: ReviewCommentController | undefined;

	activate(context: vscode.ExtensionContext): void {
		this.commentController = new ReviewCommentController(this.storage);
		this.commentController.registerCommands(context);

		const syncComments = (options?: { force?: boolean }) => {
			if (this.commentController?.isMutatingStorage()) {
				return;
			}

			void (async () => {
				if (!this.commentController?.isActivated()) {
					await this.commentController?.bootstrap(options);
					return;
				}

				await this.commentController.syncFromStorage(options?.force ? { force: true } : {});
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
			syncComments();
		};

		const bootstrapReview = () => {
			void (async () => {
				await whenWorkspaceReady();
				await this.commentController?.bootstrap();
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
				bootstrapReview();
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(`${REVIEW_CONFIG_SECTION}.storagePath`)) {
					this.storage.clearCache();
					storageWatchers.reattach();
					bootstrapReview();
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
			vscode.window.onDidChangeActiveTextEditor(() => {
				if (!this.commentController?.hasPendingBackgroundSync()) {
					return;
				}

				const editor = vscode.window.activeTextEditor;
				const inCodeEditor =
					editor?.document.uri.scheme === 'file' &&
					!isReviewStorageUri(editor.document.uri);
				if (!inCodeEditor) {
					this.commentController.flushDeferredBackgroundSync();
				}
			}),
			vscode.commands.registerCommand('zce.review.add', () => this.addComment()),
			vscode.commands.registerCommand('zce.review.copyAsMarkdown', () =>
				copyAllComments(this.storage),
			),
			vscode.commands.registerCommand('zce.review.copyUnresolvedAsMarkdown', () =>
				copyUnresolvedComments(this.storage),
			),
			vscode.commands.registerCommand('zce.review.copyFileAsMarkdown', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => copyFileCommentsForPath(this.storage, file)),
			),
			vscode.commands.registerCommand(
				'zce.review.copyFileUnresolvedAsMarkdown',
				(resource?: vscode.Uri) =>
					this.runForFile(resource, (file) =>
						copyFileUnresolvedCommentsForPath(this.storage, file),
					),
			),
			vscode.commands.registerCommand('zce.review.deleteFileComments', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => deleteFileCommentsForPath(this.storage, file), true),
			),
			vscode.commands.registerCommand(
				'zce.review.deleteResolvedFileComments',
				(resource?: vscode.Uri) =>
					this.runForFile(
						resource,
						(file) => deleteResolvedFileCommentsForPath(this.storage, file),
						true,
					),
			),
			vscode.commands.registerCommand('zce.review.deleteAllResolvedComments', async () => {
				await deleteAllResolvedComments(this.storage);
				await this.commentController?.syncFromStorage({ force: true });
			}),
			vscode.commands.registerCommand('zce.review.resolveFileComments', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => resolveFileCommentsForPath(this.storage, file), true),
			),
			vscode.commands.registerCommand('zce.review.refresh', () => this.refreshComments()),
		);

		bootstrapReview();
	}

	deactivate(): void {
		this.commentController?.dispose();
	}

	private async refreshComments(): Promise<void> {
		await this.storage.refreshFromDisk(false);
		await this.commentController?.syncFromStorage({ force: true });
		void vscode.window.showInformationMessage('Comments refreshed.');
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
		syncAfter = false,
	): Promise<void> {
		const uri = this.resolveTargetUri(resource);
		if (!uri) {
			void vscode.window.showWarningMessage('No file selected.');
			return;
		}

		await action(this.storage.toRelativePath(uri));

		if (syncAfter) {
			await this.commentController?.syncFromStorage({ force: true });
		}
	}
}
