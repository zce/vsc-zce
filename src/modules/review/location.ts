import * as vscode from 'vscode';
import { ReviewRange, ReviewThread } from './types';

export function formatLocation(thread: ReviewThread): string {
	const startLine = thread.range.startLine + 1;
	const endLine = thread.range.endLine + 1;

	if (startLine === endLine) {
		return `${thread.file}:${startLine}`;
	}

	return `${thread.file}:${startLine}-${endLine}`;
}

export function formatFileRange(file: string, range: ReviewRange): string {
	return formatLocation({
		id: '',
		file,
		range,
		body: '',
		createdAt: '',
	});
}

export function rangeToReviewRange(range: vscode.Range): ReviewRange {
	return {
		startLine: range.start.line,
		startChar: range.start.character,
		endLine: range.end.line,
		endChar: range.end.character,
	};
}

export function reviewRangeToRange(range: ReviewRange): vscode.Range {
	return new vscode.Range(
		range.startLine,
		range.startChar,
		range.endLine,
		range.endChar,
	);
}

/** Convert in-memory (0-based) range to JSON (1-based lines). */
export function reviewRangeToStorage(range: ReviewRange): ReviewRange {
	return {
		startLine: range.startLine + 1,
		startChar: range.startChar,
		endLine: range.endLine + 1,
		endChar: range.endChar,
	};
}

/** Convert JSON (1-based lines) to in-memory (0-based). */
export function reviewRangeFromStorage(range: ReviewRange): ReviewRange {
	return {
		startLine: range.startLine - 1,
		startChar: range.startChar,
		endLine: range.endLine - 1,
		endChar: range.endChar,
	};
}

export function threadToStorage(thread: ReviewThread): ReviewThread {
	return {
		...thread,
		range: reviewRangeToStorage(thread.range),
	};
}

export function threadFromStorage(thread: ReviewThread): ReviewThread {
	return {
		...thread,
		range: reviewRangeFromStorage(thread.range),
	};
}
