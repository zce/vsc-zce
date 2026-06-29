import * as vscode from 'vscode';
import { ReviewNote, ReviewNoteRange } from './types';

export function formatLocation(note: ReviewNote): string {
	const startLine = note.range.startLine + 1;
	const endLine = note.range.endLine + 1;

	if (startLine === endLine) {
		return `${note.file}:${startLine}`;
	}

	return `${note.file}:${startLine}-${endLine}`;
}

export function formatFileRange(file: string, range: ReviewNoteRange): string {
	return formatLocation({
		id: '',
		file,
		range,
		note: '',
		createdAt: '',
	});
}

export function rangeToNoteRange(range: vscode.Range): ReviewNoteRange {
	return {
		startLine: range.start.line,
		startChar: range.start.character,
		endLine: range.end.line,
		endChar: range.end.character,
	};
}

export function noteRangeToRange(range: ReviewNoteRange): vscode.Range {
	return new vscode.Range(
		range.startLine,
		range.startChar,
		range.endLine,
		range.endChar,
	);
}
