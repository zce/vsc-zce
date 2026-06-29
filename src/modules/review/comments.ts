import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
	asCommentThread,
	commentBody,
	mapThreadComment,
	REVIEW_AUTHOR,
	ReviewComment,
} from './ReviewComment';
import { formatLocation, formatFileRange, noteRangeToRange, rangeToNoteRange } from './location';
import { notesToMarkdown } from './markdownExport';
import { applyContentChangesToRange, rangesEqual } from './rangeTracking';
import { ReviewStorage } from './storage';
import { ReviewNote, ReviewNoteRange } from './types';
import { revealCommentsPanel } from './workspaceReady';

const SAVE_DELAY_MS = 400;
const RANGE_PERSIST_DELAY_MS = 400;

export class ReviewCommentController implements vscode.Disposable {
	private controller: vscode.CommentController | undefined;
	private activated = false;
	private readonly threads = new Map<string, vscode.CommentThread>();
	private readonly threadToNoteId = new WeakMap<vscode.CommentThread, string>();
	private readonly draftThreads = new WeakSet<vscode.CommentThread>();
	private readonly pendingBodies = new Map<string, string>();
	private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly syncedRanges = new Map<string, ReviewNoteRange>();
	private readonly rangePersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly noteIdsByFile = new Map<string, Set<string>>();
	private readonly noteIdsByUri = new Map<string, Set<string>>();
	private readonly noteFilesById = new Map<string, string>();
	private mutatingStorage = false;

	constructor(private readonly storage: ReviewStorage) {}

	isActivated(): boolean {
		return this.activated;
	}

	isMutatingStorage(): boolean {
		return this.mutatingStorage;
	}

	dispose(): void {
		for (const timer of this.saveTimers.values()) {
			clearTimeout(timer);
		}

		for (const timer of this.rangePersistTimers.values()) {
			clearTimeout(timer);
		}

		this.controller?.dispose();
	}

	registerCommands(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.commands.registerCommand('zce.review.submit', (reply: vscode.CommentReply) =>
				this.submitDraft(reply),
			),
			vscode.commands.registerCommand('zce.review.editComment', (comment: ReviewComment) =>
				this.editComment(comment),
			),
			vscode.commands.registerCommand('zce.review.saveComment', (comment: ReviewComment) =>
				this.saveComment(comment),
			),
			vscode.commands.registerCommand('zce.review.cancelEdit', (comment: ReviewComment) =>
				this.cancelEdit(comment),
			),
			vscode.commands.registerCommand('zce.review.deleteThread', (thread: unknown) =>
				this.deleteThread(asCommentThread(thread)),
			),
			vscode.commands.registerCommand('zce.review.resolveThread', (thread: unknown) =>
				this.setResolved(asCommentThread(thread), true),
			),
			vscode.commands.registerCommand('zce.review.unresolveThread', (thread: unknown) =>
				this.setResolved(asCommentThread(thread), false),
			),
			vscode.commands.registerCommand('zce.review.copyThreadAsMarkdown', (thread: unknown) =>
				this.copyThreadAsMarkdown(asCommentThread(thread)),
			),
		);
	}

	async bootstrap(options: { revealPanel?: boolean } = {}): Promise<void> {
		const notes = await this.storage.loadAll();
		if (notes.length === 0) {
			this.deactivateIfEmpty();
			return;
		}

		this.ensureActivated();
		await this.syncFromStorage();

		if (options.revealPanel) {
			await revealCommentsPanel();
		}
	}

	async openDraft(uri: vscode.Uri, range: vscode.Range): Promise<void> {
		await this.bootstrap({ revealPanel: true });

		const controller = this.getController();
		const thread = controller.createCommentThread(uri, range, []);
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
		thread.contextValue = 'draft';
		thread.canReply = true;
		thread.label = 'Review';
		this.draftThreads.add(thread);
	}

	async syncFromStorage(): Promise<void> {
		if (!this.activated) {
			return;
		}

		const notes = await this.storage.loadAll();
		const noteIds = new Set(notes.map((note) => note.id));

		for (const [noteId, thread] of this.threads) {
			if (!noteIds.has(noteId)) {
				this.untrackNote(noteId, thread.uri);
				thread.dispose();
				this.threads.delete(noteId);
				this.syncedRanges.delete(noteId);
			}
		}

		for (const note of notes) {
			this.ensureThread(note);
		}
	}

	hasNotesForUri(uri: vscode.Uri): boolean {
		return (this.noteIdsByUri.get(uri.toString())?.size ?? 0) > 0;
	}

	handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
		if (
			!this.activated ||
			event.contentChanges.length === 0 ||
			event.document.uri.scheme !== 'file'
		) {
			return;
		}

		const uriKey = event.document.uri.toString();
		const noteIds = this.noteIdsByUri.get(uriKey);
		if (!noteIds?.size) {
			return;
		}

		if (!vscode.workspace.getWorkspaceFolder(event.document.uri)) {
			return;
		}

		const relativePath = this.storage.toRelativePath(event.document.uri);
		let changed = false;

		for (const noteId of noteIds) {
			const thread = this.threads.get(noteId);
			const current = this.syncedRanges.get(noteId);
			if (!thread || !current) {
				continue;
			}

			const next = applyContentChangesToRange(current, event.contentChanges);
			if (rangesEqual(current, next)) {
				continue;
			}

			this.syncedRanges.set(noteId, next);
			thread.range = noteRangeToRange(next);
			thread.label = formatFileRange(relativePath, next);
			changed = true;
		}

		if (changed) {
			this.scheduleRangePersist(relativePath);
		}
	}

	private scheduleRangePersist(relativePath: string): void {
		const existing = this.rangePersistTimers.get(relativePath);
		if (existing) {
			clearTimeout(existing);
		}

		this.rangePersistTimers.set(
			relativePath,
			setTimeout(() => {
				this.rangePersistTimers.delete(relativePath);
				void this.persistSyncedRanges(relativePath);
			}, RANGE_PERSIST_DELAY_MS),
		);
	}

	private async persistSyncedRanges(relativePath: string): Promise<void> {
		const noteIds = this.noteIdsByFile.get(relativePath);
		if (!noteIds?.size) {
			return;
		}

		const rangesById = new Map<string, ReviewNoteRange>();
		for (const noteId of noteIds) {
			const range = this.syncedRanges.get(noteId);
			if (range) {
				rangesById.set(noteId, range);
			}
		}

		if (rangesById.size === 0) {
			return;
		}

		await this.withMutatingStorage(() =>
			this.storage.updateNoteRangesForFile(relativePath, rangesById),
		);
	}

	private ensureActivated(): void {
		if (this.activated) {
			return;
		}

		this.activated = true;
		this.controller = vscode.comments.createCommentController('zce.review', 'Review');
		this.controller.commentingRangeProvider = {
			provideCommentingRanges: (document, _token) => {
				if (!vscode.workspace.getWorkspaceFolder(document.uri)) {
					return [];
				}

				const lastLine = Math.max(document.lineCount - 1, 0);
				return [new vscode.Range(0, 0, lastLine, 0)];
			},
		};
		this.controller.options = {
			placeHolder: 'Write a review note...',
		};
	}

	private getController(): vscode.CommentController {
		this.ensureActivated();
		return this.controller!;
	}

	private async withMutatingStorage<T>(fn: () => Promise<T>): Promise<T> {
		this.mutatingStorage = true;
		try {
			return await fn();
		} finally {
			this.mutatingStorage = false;
		}
	}

	private async submitDraft(reply: vscode.CommentReply): Promise<void> {
		const thread = reply.thread;
		const text = reply.text.trim();
		if (!text) {
			return;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(thread.uri);
		if (!workspaceFolder) {
			void vscode.window.showWarningMessage('Save the file inside a workspace folder first.');
			return;
		}

		const range = thread.range;
		if (!range) {
			return;
		}

		const note: ReviewNote = {
			id: randomUUID(),
			file: this.storage.toRelativePath(thread.uri),
			range: rangeToNoteRange(range),
			note: text,
			createdAt: new Date().toISOString(),
			resolved: false,
		};

		await this.withMutatingStorage(() => this.storage.addNote(note, thread.uri));

		this.draftThreads.delete(thread);
		this.bindThread(note, thread);
		this.syncedRanges.set(note.id, note.range);
		this.setThreadComments(thread, note, vscode.CommentMode.Preview);
		this.applyThreadMetadata(thread, note);
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
		thread.canReply = false;
	}

	private editComment(comment: ReviewComment): void {
		const thread = comment.parent;
		if (thread.contextValue === 'resolved') {
			return;
		}

		mapThreadComment(thread, comment.noteId, (current) =>
			new ReviewComment(
				current.noteId,
				commentBody(current.body),
				vscode.CommentMode.Editing,
				current.author,
				thread,
			),
		);
	}

	private saveComment(comment: ReviewComment): void {
		const thread = comment.parent;
		const body = commentBody(comment.body);

		mapThreadComment(thread, comment.noteId, (current) =>
			new ReviewComment(
				current.noteId,
				body,
				vscode.CommentMode.Preview,
				current.author,
				thread,
			),
		);

		this.scheduleSave(comment.noteId, body);
	}

	private cancelEdit(comment: ReviewComment): void {
		const thread = comment.parent;

		mapThreadComment(thread, comment.noteId, (current) =>
			new ReviewComment(
				current.noteId,
				current.savedBody,
				vscode.CommentMode.Preview,
				current.author,
				thread,
			),
		);
	}

	private async deleteThread(thread: vscode.CommentThread | undefined): Promise<void> {
		if (!thread) {
			return;
		}

		if (this.draftThreads.has(thread)) {
			this.draftThreads.delete(thread);
			thread.dispose();
			return;
		}

		const noteId = this.threadToNoteId.get(thread);
		if (!noteId) {
			thread.dispose();
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			'Delete this note permanently?',
			{ modal: true },
			'Delete',
		);
		if (confirm !== 'Delete') {
			return;
		}

		await this.deleteNoteById(noteId);
	}

	private async setResolved(
		thread: vscode.CommentThread | undefined,
		resolved: boolean,
	): Promise<void> {
		if (!thread) {
			return;
		}

		const noteId = this.threadToNoteId.get(thread);
		if (!noteId) {
			return;
		}

		const note = await this.storage.ensureNoteLoaded(noteId);
		if (!note) {
			return;
		}

		note.resolved = resolved;
		note.resolvedAt = resolved ? new Date().toISOString() : undefined;

		await this.withMutatingStorage(() => this.storage.updateNote(note));
		this.applyThreadMetadata(thread, note);
	}

	private async copyThreadAsMarkdown(thread: vscode.CommentThread | undefined): Promise<void> {
		if (!thread) {
			return;
		}

		const noteId = this.threadToNoteId.get(thread);
		if (!noteId) {
			return;
		}

		const note = await this.storage.ensureNoteLoaded(noteId);
		if (!note) {
			return;
		}

		const markdown = notesToMarkdown([note]);
		await vscode.env.clipboard.writeText(markdown);
		void vscode.window.showInformationMessage('Copied note as Markdown.');
	}

	private scheduleSave(noteId: string, body: string): void {
		this.pendingBodies.set(noteId, body);

		const existing = this.saveTimers.get(noteId);
		if (existing) {
			clearTimeout(existing);
		}

		this.saveTimers.set(
			noteId,
			setTimeout(() => {
				void this.flushSave(noteId);
			}, SAVE_DELAY_MS),
		);
	}

	private async flushSave(noteId: string): Promise<void> {
		const body = this.pendingBodies.get(noteId);
		if (body === undefined) {
			return;
		}

		this.pendingBodies.delete(noteId);
		this.saveTimers.delete(noteId);

		const note = await this.storage.ensureNoteLoaded(noteId);
		if (!note) {
			return;
		}

		const trimmed = body.trim();
		if (!trimmed) {
			await this.deleteNoteById(noteId);
			return;
		}

		note.note = trimmed;
		await this.withMutatingStorage(() => this.storage.updateNote(note));
	}

	private async deleteNoteById(noteId: string): Promise<void> {
		const note = await this.storage.ensureNoteLoaded(noteId);
		if (!note) {
			return;
		}

		const thread = this.threads.get(noteId);
		if (thread) {
			this.untrackNote(noteId, thread.uri);
			this.threads.delete(noteId);
			this.syncedRanges.delete(noteId);
			thread.dispose();
		}

		await this.withMutatingStorage(() => this.storage.removeNote(note));
	}

	private ensureThread(note: ReviewNote): void {
		const workspaceFolder = this.storage.resolveWorkspaceFolder(note);
		if (!workspaceFolder) {
			return;
		}

		const controller = this.getController();
		const uri = vscode.Uri.file(this.storage.toAbsolutePath(note, workspaceFolder));
		const range = noteRangeToRange(note.range);

		let thread = this.threads.get(note.id);
		if (thread && thread.uri.toString() !== uri.toString()) {
			this.untrackNote(note.id, thread.uri);
			this.threads.delete(note.id);
			this.syncedRanges.delete(note.id);
			thread.dispose();
			thread = undefined;
		}

		if (!thread) {
			thread = controller.createCommentThread(uri, range, []);
			thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
			thread.canReply = false;
			this.bindThread(note, thread);
			thread.range = range;
			this.syncedRanges.set(note.id, note.range);
		} else {
			const lastSynced = this.syncedRanges.get(note.id);
			if (lastSynced && !rangesEqual(lastSynced, note.range)) {
				thread.range = range;
				this.syncedRanges.set(note.id, note.range);
			} else if (!lastSynced) {
				this.syncedRanges.set(note.id, note.range);
			}
		}

		this.applyThreadMetadata(thread, note);

		const existing = thread.comments[0] as ReviewComment | undefined;
		if (!existing || existing.mode === vscode.CommentMode.Editing) {
			if (!existing) {
				this.setThreadComments(thread, note, vscode.CommentMode.Preview);
			}
			return;
		}

		if (commentBody(existing.body) !== note.note) {
			this.setThreadComments(thread, note, vscode.CommentMode.Preview);
		}
	}

	private applyThreadMetadata(thread: vscode.CommentThread, note: ReviewNote): void {
		thread.contextValue = note.resolved ? 'resolved' : 'open';
		thread.state = note.resolved
			? vscode.CommentThreadState.Resolved
			: vscode.CommentThreadState.Unresolved;
		thread.label = formatLocation(note);
	}

	private setThreadComments(
		thread: vscode.CommentThread,
		note: ReviewNote,
		mode: vscode.CommentMode,
	): void {
		thread.comments = [
			new ReviewComment(note.id, note.note, mode, REVIEW_AUTHOR, thread),
		];
	}

	private bindThread(note: ReviewNote, thread: vscode.CommentThread): void {
		this.threads.set(note.id, thread);
		this.threadToNoteId.set(thread, note.id);
		this.trackNote(note.id, thread.uri, note.file);
	}

	private trackNote(noteId: string, uri: vscode.Uri, relativePath: string): void {
		this.noteFilesById.set(noteId, relativePath);

		const uriKey = uri.toString();
		let byUri = this.noteIdsByUri.get(uriKey);
		if (!byUri) {
			byUri = new Set();
			this.noteIdsByUri.set(uriKey, byUri);
		}
		byUri.add(noteId);

		let byFile = this.noteIdsByFile.get(relativePath);
		if (!byFile) {
			byFile = new Set();
			this.noteIdsByFile.set(relativePath, byFile);
		}
		byFile.add(noteId);
	}

	private untrackNote(noteId: string, uri: vscode.Uri): void {
		const relativePath = this.noteFilesById.get(noteId);
		this.noteFilesById.delete(noteId);

		const uriKey = uri.toString();
		const byUri = this.noteIdsByUri.get(uriKey);
		if (byUri) {
			byUri.delete(noteId);
			if (byUri.size === 0) {
				this.noteIdsByUri.delete(uriKey);
			}
		}

		if (relativePath) {
			const byFile = this.noteIdsByFile.get(relativePath);
			if (byFile) {
				byFile.delete(noteId);
				if (byFile.size === 0) {
					this.noteIdsByFile.delete(relativePath);
				}
			}
		}
	}

	private deactivateIfEmpty(): void {
		for (const thread of this.threads.values()) {
			thread.dispose();
		}

		this.threads.clear();
		this.syncedRanges.clear();
		this.noteIdsByFile.clear();
		this.noteIdsByUri.clear();
		this.noteFilesById.clear();
		this.controller?.dispose();
		this.controller = undefined;
		this.activated = false;
	}
}
