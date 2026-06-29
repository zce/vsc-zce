import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
	asCommentThread,
	commentBody,
	mapThreadComment,
	replyAuthor,
	replyContextValue,
	ReviewComment,
	ROOT_COMMENT_AUTHOR,
	USER_REPLY_AUTHOR,
} from './ReviewComment';
import {
	formatFileRange,
	formatLocation,
	reviewRangeToRange,
	rangeToReviewRange,
} from './location';
import { commentsToMarkdown } from './markdownExport';
import { applyContentChangesToRange, rangesEqual } from './rangeTracking';
import { ReviewStorage } from './storage';
import { ReviewRange, ReviewReply, ReviewThread } from './types';
import { revealCommentsPanel } from './workspaceReady';

const SAVE_DELAY_MS = 400;
const RANGE_PERSIST_DELAY_MS = 400;

export class ReviewCommentController implements vscode.Disposable {
	private controller: vscode.CommentController | undefined;
	private activated = false;
	private readonly uiThreads = new Map<string, vscode.CommentThread>();
	private readonly threadToStorageId = new WeakMap<vscode.CommentThread, string>();
	private readonly draftThreads = new WeakSet<vscode.CommentThread>();
	private readonly pendingBodies = new Map<string, string>();
	private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly syncedRanges = new Map<string, ReviewRange>();
	private readonly rangePersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly threadIdsByFile = new Map<string, Set<string>>();
	private readonly threadIdsByUri = new Map<string, Set<string>>();
	private readonly threadFilesById = new Map<string, string>();
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
				this.submit(reply),
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
		const threads = await this.storage.loadAll();
		if (threads.length === 0) {
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
		const uiThread = controller.createCommentThread(uri, range, []);
		uiThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
		uiThread.contextValue = 'draft';
		uiThread.canReply = true;
		uiThread.label = 'Review';
		this.draftThreads.add(uiThread);
	}

	async syncFromStorage(): Promise<void> {
		if (!this.activated) {
			return;
		}

		const threads = await this.storage.loadAll();
		const storageIds = new Set(threads.map((thread) => thread.id));

		for (const [storageId, uiThread] of this.uiThreads) {
			if (!storageIds.has(storageId)) {
				this.untrackThread(storageId, uiThread.uri);
				uiThread.dispose();
				this.uiThreads.delete(storageId);
				this.syncedRanges.delete(storageId);
			}
		}

		for (const thread of threads) {
			this.applyStorageThread(thread);
		}
	}

	hasCommentsForUri(uri: vscode.Uri): boolean {
		return (this.threadIdsByUri.get(uri.toString())?.size ?? 0) > 0;
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
		const storageIds = this.threadIdsByUri.get(uriKey);
		if (!storageIds?.size) {
			return;
		}

		if (!vscode.workspace.getWorkspaceFolder(event.document.uri)) {
			return;
		}

		const relativePath = this.storage.toRelativePath(event.document.uri);
		let changed = false;

		for (const storageId of storageIds) {
			const uiThread = this.uiThreads.get(storageId);
			const current = this.syncedRanges.get(storageId);
			if (!uiThread || !current) {
				continue;
			}

			const next = applyContentChangesToRange(current, event.contentChanges);
			if (rangesEqual(current, next)) {
				continue;
			}

			this.syncedRanges.set(storageId, next);
			uiThread.range = reviewRangeToRange(next);
			uiThread.label = formatFileRange(relativePath, next);
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
		const storageIds = this.threadIdsByFile.get(relativePath);
		if (!storageIds?.size) {
			return;
		}

		const rangesById = new Map<string, ReviewRange>();
		for (const storageId of storageIds) {
			const range = this.syncedRanges.get(storageId);
			if (range) {
				rangesById.set(storageId, range);
			}
		}

		if (rangesById.size === 0) {
			return;
		}

		await this.withMutatingStorage(() =>
			this.storage.updateThreadRangesForFile(relativePath, rangesById),
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
			placeHolder: 'Write a review comment...',
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

	private async submit(reply: vscode.CommentReply): Promise<void> {
		if (this.isDraft(reply.thread)) {
			await this.submitDraft(reply);
			return;
		}

		await this.submitReply(reply);
	}

	private isDraft(uiThread: vscode.CommentThread): boolean {
		if (uiThread.contextValue === 'draft' || this.draftThreads.has(uiThread)) {
			return true;
		}

		if (this.resolveStorageId(uiThread)) {
			return false;
		}

		return uiThread.comments.length === 0;
	}

	private resolveStorageId(uiThread: vscode.CommentThread): string | undefined {
		const mapped = this.threadToStorageId.get(uiThread);
		if (mapped) {
			return mapped;
		}

		for (const [storageId, stored] of this.uiThreads) {
			if (stored === uiThread) {
				this.threadToStorageId.set(uiThread, storageId);
				return storageId;
			}
		}

		if (uiThread.contextValue === 'draft') {
			return undefined;
		}

		const uri = uiThread.uri.toString();
		const range = uiThread.range;
		if (!range) {
			return undefined;
		}

		for (const [storageId, stored] of this.uiThreads) {
			if (stored.uri.toString() === uri && stored.range?.isEqual(range)) {
				this.threadToStorageId.set(uiThread, storageId);
				return storageId;
			}
		}

		return undefined;
	}

	private async submitDraft(reply: vscode.CommentReply): Promise<void> {
		const uiThread = reply.thread;
		const text = reply.text.trim();
		if (!text) {
			return;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uiThread.uri);
		if (!workspaceFolder) {
			void vscode.window.showWarningMessage('Save the file inside a workspace folder first.');
			return;
		}

		const range = uiThread.range;
		if (!range) {
			return;
		}

		const thread: ReviewThread = {
			id: randomUUID(),
			file: this.storage.toRelativePath(uiThread.uri),
			range: rangeToReviewRange(range),
			body: text,
			createdAt: new Date().toISOString(),
			replies: [],
			resolved: false,
		};

		await this.withMutatingStorage(() => this.storage.addThread(thread, uiThread.uri));

		this.draftThreads.delete(uiThread);
		this.bindStorageThread(thread, uiThread);
		this.syncedRanges.set(thread.id, thread.range);
		this.setUiComments(uiThread, thread);
		this.applyThreadMetadata(uiThread, thread);
		uiThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
	}

	private async submitReply(reply: vscode.CommentReply): Promise<void> {
		const uiThread = reply.thread;
		const text = reply.text.trim();
		if (!text) {
			return;
		}

		const storageId = this.resolveStorageId(uiThread);
		if (!storageId) {
			void vscode.window.showWarningMessage('Could not save reply: comment thread is not linked.');
			return;
		}

		const thread = await this.storage.ensureThreadLoaded(storageId);
		if (!thread || thread.resolved) {
			return;
		}

		const entry: ReviewReply = {
			id: randomUUID(),
			body: text,
			author: USER_REPLY_AUTHOR,
			createdAt: new Date().toISOString(),
		};

		thread.replies = [...(thread.replies ?? []), entry];
		await this.withMutatingStorage(() => this.storage.updateThread(thread));
		this.setUiComments(uiThread, thread);
	}

	private editComment(comment: ReviewComment): void {
		const uiThread = comment.parent;
		if (!this.isEditableComment(comment, uiThread)) {
			return;
		}

		mapThreadComment(uiThread, comment.commentId, (current) =>
			new ReviewComment(
				current.commentId,
				current.threadId,
				current.isRoot,
				commentBody(current.body),
				vscode.CommentMode.Editing,
				current.author,
				uiThread,
				current.contextValue,
			),
		);
	}

	private saveComment(comment: ReviewComment): void {
		const uiThread = comment.parent;
		if (!this.isEditableComment(comment, uiThread)) {
			return;
		}

		const body = commentBody(comment.body);

		mapThreadComment(uiThread, comment.commentId, (current) =>
			new ReviewComment(
				current.commentId,
				current.threadId,
				current.isRoot,
				body,
				vscode.CommentMode.Preview,
				current.author,
				uiThread,
				current.contextValue,
			),
		);

		this.scheduleSave(comment, body);
	}

	private cancelEdit(comment: ReviewComment): void {
		const uiThread = comment.parent;

		mapThreadComment(uiThread, comment.commentId, (current) =>
			new ReviewComment(
				current.commentId,
				current.threadId,
				current.isRoot,
				current.savedBody,
				vscode.CommentMode.Preview,
				current.author,
				uiThread,
				current.contextValue,
			),
		);
	}

	private isEditableComment(
		comment: ReviewComment,
		uiThread: vscode.CommentThread,
	): boolean {
		if (uiThread.contextValue === 'resolved') {
			return false;
		}

		return comment.isRoot || comment.contextValue === 'userReply';
	}

	private async deleteThread(uiThread: vscode.CommentThread | undefined): Promise<void> {
		if (!uiThread) {
			return;
		}

		if (this.isDraft(uiThread)) {
			this.draftThreads.delete(uiThread);
			uiThread.dispose();
			return;
		}

		const storageId = this.resolveStorageId(uiThread);
		if (!storageId) {
			uiThread.dispose();
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

		await this.deleteThreadById(storageId);
	}

	private async setResolved(
		uiThread: vscode.CommentThread | undefined,
		resolved: boolean,
	): Promise<void> {
		if (!uiThread) {
			return;
		}

		const storageId = this.resolveStorageId(uiThread);
		if (!storageId) {
			return;
		}

		const thread = await this.storage.ensureThreadLoaded(storageId);
		if (!thread) {
			return;
		}

		thread.resolved = resolved;
		thread.resolvedAt = resolved ? new Date().toISOString() : undefined;

		await this.withMutatingStorage(() => this.storage.updateThread(thread));
		this.applyThreadMetadata(uiThread, thread);
	}

	private async copyThreadAsMarkdown(uiThread: vscode.CommentThread | undefined): Promise<void> {
		if (!uiThread) {
			return;
		}

		const storageId = this.resolveStorageId(uiThread);
		if (!storageId) {
			return;
		}

		const thread = await this.storage.ensureThreadLoaded(storageId);
		if (!thread) {
			return;
		}

		const markdown = commentsToMarkdown([thread]);
		await vscode.env.clipboard.writeText(markdown);
		void vscode.window.showInformationMessage('Copied comment as Markdown.');
	}

	private scheduleSave(comment: ReviewComment, body: string): void {
		const key = comment.isRoot ? comment.commentId : `${comment.threadId}:${comment.commentId}`;
		this.pendingBodies.set(key, body);

		const existing = this.saveTimers.get(key);
		if (existing) {
			clearTimeout(existing);
		}

		this.saveTimers.set(
			key,
			setTimeout(() => {
				void this.flushSave(key);
			}, SAVE_DELAY_MS),
		);
	}

	private async flushSave(key: string): Promise<void> {
		const body = this.pendingBodies.get(key);
		if (body === undefined) {
			return;
		}

		this.pendingBodies.delete(key);
		this.saveTimers.delete(key);

		if (key.includes(':')) {
			const [storageId, replyId] = key.split(':');
			const thread = await this.storage.ensureThreadLoaded(storageId);
			if (!thread) {
				return;
			}

			const reply = thread.replies?.find((entry) => entry.id === replyId);
			if (!reply) {
				return;
			}

			const trimmed = body.trim();
			if (!trimmed) {
				thread.replies = thread.replies?.filter((entry) => entry.id !== replyId);
			} else {
				reply.body = trimmed;
			}

			await this.withMutatingStorage(() => this.storage.updateThread(thread));

			const uiThread = this.uiThreads.get(storageId);
			if (uiThread) {
				this.setUiComments(uiThread, thread);
			}

			return;
		}

		const thread = await this.storage.ensureThreadLoaded(key);
		if (!thread) {
			return;
		}

		const trimmed = body.trim();
		if (!trimmed) {
			await this.deleteThreadById(key);
			return;
		}

		thread.body = trimmed;
		await this.withMutatingStorage(() => this.storage.updateThread(thread));
	}

	private async deleteThreadById(storageId: string): Promise<void> {
		const thread = await this.storage.ensureThreadLoaded(storageId);
		if (!thread) {
			return;
		}

		const uiThread = this.uiThreads.get(storageId);
		if (uiThread) {
			this.untrackThread(storageId, uiThread.uri);
			this.uiThreads.delete(storageId);
			this.syncedRanges.delete(storageId);
			uiThread.dispose();
		}

		await this.withMutatingStorage(() => this.storage.removeThread(thread));
	}

	private applyStorageThread(thread: ReviewThread): void {
		const workspaceFolder = this.storage.resolveWorkspaceFolder(thread);
		if (!workspaceFolder) {
			return;
		}

		const controller = this.getController();
		const uri = vscode.Uri.file(this.storage.toAbsolutePath(thread, workspaceFolder));
		const range = reviewRangeToRange(thread.range);

		let uiThread = this.uiThreads.get(thread.id);
		if (uiThread && uiThread.uri.toString() !== uri.toString()) {
			this.untrackThread(thread.id, uiThread.uri);
			this.uiThreads.delete(thread.id);
			this.syncedRanges.delete(thread.id);
			uiThread.dispose();
			uiThread = undefined;
		}

		if (!uiThread) {
			uiThread = controller.createCommentThread(uri, range, []);
			uiThread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
			this.bindStorageThread(thread, uiThread);
			uiThread.range = range;
			this.syncedRanges.set(thread.id, thread.range);
		} else {
			const lastSynced = this.syncedRanges.get(thread.id);
			if (lastSynced && !rangesEqual(lastSynced, thread.range)) {
				uiThread.range = range;
				this.syncedRanges.set(thread.id, thread.range);
			} else if (!lastSynced) {
				this.syncedRanges.set(thread.id, thread.range);
			}
		}

		this.applyThreadMetadata(uiThread, thread);

		if (this.isUiThreadEditing(uiThread)) {
			return;
		}

		if (!this.uiMatchesStorage(uiThread, thread)) {
			this.setUiComments(uiThread, thread);
		}
	}

	private isUiThreadEditing(uiThread: vscode.CommentThread): boolean {
		return uiThread.comments.some(
			(item) => (item as ReviewComment).mode === vscode.CommentMode.Editing,
		);
	}

	private uiMatchesStorage(uiThread: vscode.CommentThread, thread: ReviewThread): boolean {
		const displayed = uiThread.comments as ReviewComment[];
		const replies = thread.replies ?? [];

		if (displayed.length !== 1 + replies.length) {
			return false;
		}

		const root = displayed[0];
		if (!root?.isRoot || root.commentId !== thread.id || commentBody(root.body) !== thread.body) {
			return false;
		}

		for (let index = 0; index < replies.length; index += 1) {
			const reply = replies[index];
			const comment = displayed[index + 1];
			if (
				!comment ||
				comment.isRoot ||
				comment.commentId !== reply.id ||
				commentBody(comment.body) !== reply.body ||
				comment.author.name !== replyAuthor(reply.author).name
			) {
				return false;
			}
		}

		return true;
	}

	private applyThreadMetadata(uiThread: vscode.CommentThread, thread: ReviewThread): void {
		uiThread.contextValue = thread.resolved ? 'resolved' : 'open';
		uiThread.state = thread.resolved
			? vscode.CommentThreadState.Resolved
			: vscode.CommentThreadState.Unresolved;
		uiThread.label = formatLocation(thread);
		uiThread.canReply = !thread.resolved;
	}

	private setUiComments(uiThread: vscode.CommentThread, thread: ReviewThread): void {
		const existing = new Map(
			uiThread.comments.map((item) => [(item as ReviewComment).commentId, item as ReviewComment]),
		);

		const rootExisting = existing.get(thread.id);
		const rootMode =
			rootExisting?.mode === vscode.CommentMode.Editing
				? vscode.CommentMode.Editing
				: vscode.CommentMode.Preview;

		const comments: ReviewComment[] = [
			new ReviewComment(
				thread.id,
				thread.id,
				true,
				thread.body,
				rootMode,
				ROOT_COMMENT_AUTHOR,
				uiThread,
			),
		];

		for (const reply of thread.replies ?? []) {
			comments.push(
				new ReviewComment(
					reply.id,
					thread.id,
					false,
					reply.body,
					vscode.CommentMode.Preview,
					replyAuthor(reply.author),
					uiThread,
					replyContextValue(reply.author),
				),
			);
		}

		uiThread.comments = comments;
		this.threadToStorageId.set(uiThread, thread.id);
	}

	private bindStorageThread(thread: ReviewThread, uiThread: vscode.CommentThread): void {
		this.uiThreads.set(thread.id, uiThread);
		this.threadToStorageId.set(uiThread, thread.id);
		this.trackThread(thread.id, uiThread.uri, thread.file);
	}

	private trackThread(storageId: string, uri: vscode.Uri, relativePath: string): void {
		this.threadFilesById.set(storageId, relativePath);

		const uriKey = uri.toString();
		let byUri = this.threadIdsByUri.get(uriKey);
		if (!byUri) {
			byUri = new Set();
			this.threadIdsByUri.set(uriKey, byUri);
		}
		byUri.add(storageId);

		let byFile = this.threadIdsByFile.get(relativePath);
		if (!byFile) {
			byFile = new Set();
			this.threadIdsByFile.set(relativePath, byFile);
		}
		byFile.add(storageId);
	}

	private untrackThread(storageId: string, uri: vscode.Uri): void {
		const relativePath = this.threadFilesById.get(storageId);
		this.threadFilesById.delete(storageId);

		const uriKey = uri.toString();
		const byUri = this.threadIdsByUri.get(uriKey);
		if (byUri) {
			byUri.delete(storageId);
			if (byUri.size === 0) {
				this.threadIdsByUri.delete(uriKey);
			}
		}

		if (relativePath) {
			const byFile = this.threadIdsByFile.get(relativePath);
			if (byFile) {
				byFile.delete(storageId);
				if (byFile.size === 0) {
					this.threadIdsByFile.delete(relativePath);
				}
			}
		}
	}

	private deactivateIfEmpty(): void {
		for (const uiThread of this.uiThreads.values()) {
			uiThread.dispose();
		}

		this.uiThreads.clear();
		this.syncedRanges.clear();
		this.threadIdsByFile.clear();
		this.threadIdsByUri.clear();
		this.threadFilesById.clear();
		this.controller?.dispose();
		this.controller = undefined;
		this.activated = false;
	}
}
