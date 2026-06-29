import { storedReplyAuthor } from './ReviewComment';
import { formatLocation } from './location';
import { ReviewReply, ReviewThread } from './types';

function sectionHeading(thread: ReviewThread): string {
	return `## ${formatLocation(thread)}`;
}

function formatReply(reply: ReviewReply): string {
	const author = storedReplyAuthor(reply.author);
	return [`### ${author}`, '', reply.body.trim()].join('\n');
}

function formatThreadSection(thread: ReviewThread): string {
	const parts = [sectionHeading(thread), '', thread.body.trim()];
	for (const reply of thread.replies ?? []) {
		parts.push('', formatReply(reply));
	}
	return parts.join('\n');
}

export function commentsToMarkdown(threads: ReviewThread[]): string {
	if (threads.length === 0) {
		return '';
	}

	if (threads.length === 1) {
		return formatThreadSection(threads[0]) + '\n';
	}

	return threads.map(formatThreadSection).join('\n\n---\n\n') + '\n';
}
