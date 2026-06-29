import * as vscode from 'vscode';
import { ExtensionModule } from '../../module';
import { REVIEW_CONFIG_SECTION } from './config';
import { ReviewCommentController } from './comments';
import {
	copyFileNotesForPath,
	deleteFileNotesForPath,
	resolveFileNotesForPath,
} from './fileActions';
import { notesToMarkdown } from './markdownExport';
import { ReviewStorage } from './storage';
import { scheduleStartupRetries, whenWorkspaceReady } from './workspaceReady';

export class ReviewModule implements ExtensionModule {
	private readonly storage = new ReviewStorage();
	private commentController: ReviewCommentController | undefined;

	activate(context: vscode.ExtensionContext): void {
		this.commentController = new ReviewCommentController(this.storage);
		this.commentController.registerCommands(context);

		const syncComments = () => {
			if (!this.commentController?.isActivated() || this.commentController.isMutatingStorage()) {
				return;
			}

			void this.commentController.syncFromStorage();
		};

		const bootstrapReview = (revealPanel = false) => {
			void (async () => {
				await whenWorkspaceReady();
				await this.commentController?.bootstrap({ revealPanel });
			})();
		};

		context.subscriptions.push(
			this.commentController,
			this.storage.onDidChange(syncComments),
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				this.storage.clearCache();
				bootstrapReview(true);
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(`${REVIEW_CONFIG_SECTION}.storagePath`)) {
					this.storage.clearCache();
					bootstrapReview(true);
				}
			}),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (!this.commentController?.isActivated()) {
					return;
				}

				if (!this.commentController.hasNotesForUri(event.document.uri)) {
					return;
				}

				this.commentController.handleDocumentChange(event);
			}),
			scheduleStartupRetries(() => bootstrapReview(true)),
			vscode.commands.registerCommand('zce.review.add', () => this.addNote()),
			vscode.commands.registerCommand('zce.review.copyAsMarkdown', () =>
				this.copyAsMarkdown(),
			),
			vscode.commands.registerCommand('zce.review.copyFileAsMarkdown', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => copyFileNotesForPath(this.storage, file)),
			),
			vscode.commands.registerCommand('zce.review.resolveFileNotes', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => resolveFileNotesForPath(this.storage, file)),
			),
			vscode.commands.registerCommand('zce.review.deleteFileNotes', (resource?: vscode.Uri) =>
				this.runForFile(resource, (file) => deleteFileNotesForPath(this.storage, file)),
			),
		);
	}

	deactivate(): void {
		this.commentController?.dispose();
	}

	private async addNote(): Promise<void> {
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
		const notes = await this.storage.loadAll();
		if (notes.length === 0) {
			void vscode.window.showWarningMessage('No notes to export.');
			return;
		}

		const markdown = notesToMarkdown(notes);
		await vscode.env.clipboard.writeText(markdown);
		void vscode.window.showInformationMessage(
			`Copied ${notes.length} note${notes.length === 1 ? '' : 's'} as Markdown.`,
		);
	}
}
