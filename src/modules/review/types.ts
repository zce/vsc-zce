export interface ReviewRange {
	startLine: number;
	startChar: number;
	endLine: number;
	endChar: number;
}

/** A reply on a comment thread. Use `User` for human follow-ups and `Agent` (or a custom name) for agent responses. */
export interface ReviewReply {
	id: string;
	body: string;
	author?: string;
	createdAt: string;
}

/** A review comment thread: root body, optional replies, and source location. */
export interface ReviewThread {
	id: string;
	file: string;
	range: ReviewRange;
	body: string;
	createdAt: string;
	replies?: ReviewReply[];
	resolved?: boolean;
	resolvedAt?: string;
}

export interface ReviewDocument {
	comments: ReviewThread[];
}
