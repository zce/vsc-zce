export interface ReviewNoteRange {
	startLine: number;
	startChar: number;
	endLine: number;
	endChar: number;
}

export interface ReviewNote {
	id: string;
	file: string;
	range: ReviewNoteRange;
	note: string;
	createdAt: string;
	resolved?: boolean;
	resolvedAt?: string;
}

export interface ReviewFile {
	notes: ReviewNote[];
}
