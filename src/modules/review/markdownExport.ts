import { formatLocation } from './location';
import { ReviewNote } from './types';

function sectionHeading(note: ReviewNote): string {
	return `## ${formatLocation(note)}`;
}

function formatNoteSection(note: ReviewNote): string {
	return [sectionHeading(note), '', note.note.trim()].join('\n');
}

export function notesToMarkdown(notes: ReviewNote[]): string {
	if (notes.length === 0) {
		return '';
	}

	if (notes.length === 1) {
		return formatNoteSection(notes[0]) + '\n';
	}

	return notes.map(formatNoteSection).join('\n\n---\n\n') + '\n';
}
