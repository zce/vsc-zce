import * as vscode from 'vscode';

export const ROOT_COMMENT_AUTHOR: vscode.CommentAuthorInformation = { name: 'Review' };
export const USER_REPLY_AUTHOR = 'User';
export const DEFAULT_REPLY_AUTHOR = 'Agent';

export function commentBody(body: string | vscode.MarkdownString): string {
	return typeof body === 'string' ? body : body.value;
}

/** Maps stored reply author to UI label (`User` → `You`). */
export function replyAuthor(name?: string): vscode.CommentAuthorInformation {
	const stored = name?.trim() || DEFAULT_REPLY_AUTHOR;
	if (stored === USER_REPLY_AUTHOR || stored === 'You') {
		return { name: 'You' };
	}

	return { name: stored };
}

/** Normalizes reply author for JSON export and agent-facing output. */
export function storedReplyAuthor(name?: string): string {
	const stored = name?.trim();
	if (!stored || stored === 'You') {
		return USER_REPLY_AUTHOR;
	}

	return stored;
}

/** Context value for a reply comment in VS Code comment menus. */
export function replyContextValue(storedAuthor?: string): string {
	return storedReplyAuthor(storedAuthor) === USER_REPLY_AUTHOR ? 'userReply' : 'agentReply';
}

export class ReviewComment implements vscode.Comment {
	savedBody: string;
	contextValue: string;

	constructor(
		public readonly commentId: string,
		public readonly threadId: string,
		public readonly isRoot: boolean,
		public body: string,
		public mode: vscode.CommentMode,
		public author: vscode.CommentAuthorInformation,
		public parent: vscode.CommentThread,
		contextValue?: string,
	) {
		this.savedBody = body;
		this.contextValue = contextValue ?? (isRoot ? 'root' : 'reply');
	}

	get id(): string {
		return this.commentId;
	}
}

export function mapThreadComment(
	thread: vscode.CommentThread,
	commentId: string,
	map: (current: ReviewComment) => ReviewComment,
): void {
	thread.comments = thread.comments.map((item) => {
		const current = item as ReviewComment;
		return current.commentId !== commentId ? item : map(current);
	});
}

export function asCommentThread(value: unknown): vscode.CommentThread | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	if ('thread' in value && value.thread) {
		return value.thread as vscode.CommentThread;
	}

	if ('uri' in value && 'comments' in value) {
		return value as vscode.CommentThread;
	}

	return undefined;
}
