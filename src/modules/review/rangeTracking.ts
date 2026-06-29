import * as vscode from 'vscode';
import { ReviewRange } from './types';

export function rangesEqual(a: ReviewRange, b: ReviewRange): boolean {
	return (
		a.startLine === b.startLine &&
		a.startChar === b.startChar &&
		a.endLine === b.endLine &&
		a.endChar === b.endChar
	);
}

function translatePosition(
	position: vscode.Position,
	change: vscode.TextDocumentContentChangeEvent,
): vscode.Position {
	const start = change.range.start;
	const end = change.range.end;

	if (position.isBefore(start)) {
		return position;
	}

	if (position.isBefore(end)) {
		return start;
	}

	const newTextLines = change.text.split(/\r\n|\n/u);
	const lineDelta = newTextLines.length - 1 - (end.line - start.line);

	if (lineDelta === 0) {
		if (position.line !== end.line) {
			return position;
		}

		const charDelta = change.text.length - (end.character - start.character);
		return new vscode.Position(position.line, position.character + charDelta);
	}

	if (position.line === end.line) {
		const lastLineLength = newTextLines[newTextLines.length - 1].length;
		const characterOffset = position.character - end.character;
		return new vscode.Position(
			start.line + newTextLines.length - 1,
			lastLineLength + characterOffset,
		);
	}

	return new vscode.Position(position.line + lineDelta, position.character);
}

export function applyContentChangesToRange(
	range: ReviewRange,
	changes: readonly vscode.TextDocumentContentChangeEvent[],
): ReviewRange {
	let start = new vscode.Position(range.startLine, range.startChar);
	let end = new vscode.Position(range.endLine, range.endChar);

	const ordered =
		changes.length <= 1
			? changes
			: [...changes].sort((a, b) => a.range.start.compareTo(b.range.start));

	for (const change of ordered) {
		start = translatePosition(start, change);
		end = translatePosition(end, change);
	}

	return {
		startLine: start.line,
		startChar: start.character,
		endLine: end.line,
		endChar: end.character,
	};
}
