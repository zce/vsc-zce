import * as vscode from 'vscode';

export const REVIEW_AUTHOR: vscode.CommentAuthorInformation = { name: 'Review' };

export function commentBody(body: string | vscode.MarkdownString): string {
	return typeof body === 'string' ? body : body.value;
}

export class ReviewComment implements vscode.Comment {
	savedBody: string;

	constructor(
		public readonly noteId: string,
		public body: string,
		public mode: vscode.CommentMode,
		public author: vscode.CommentAuthorInformation,
		public parent: vscode.CommentThread,
	) {
		this.savedBody = body;
	}

	get id(): string {
		return this.noteId;
	}
}

export function mapThreadComment(
	thread: vscode.CommentThread,
	noteId: string,
	map: (current: ReviewComment) => ReviewComment,
): void {
	thread.comments = thread.comments.map((item) => {
		const current = item as ReviewComment;
		return current.noteId !== noteId ? item : map(current);
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
