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
