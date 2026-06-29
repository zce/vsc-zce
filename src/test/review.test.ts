import * as assert from 'assert';
import * as vscode from 'vscode';
import { formatLocation } from '../modules/review/location';
import { commentsToMarkdown } from '../modules/review/markdownExport';
import { applyContentChangesToRange } from '../modules/review/rangeTracking';
import { ReviewThread } from '../modules/review/types';

function change(
	startLine: number,
	startChar: number,
	endLine: number,
	endChar: number,
	text: string,
): vscode.TextDocumentContentChangeEvent {
	return {
		range: new vscode.Range(startLine, startChar, endLine, endChar),
		rangeOffset: 0,
		rangeLength: 0,
		text,
	};
}

suite('Review location', () => {
	test('formats single line location', () => {
		const thread: ReviewThread = {
			id: '1',
			file: 'src/foo.ts',
			range: { startLine: 41, startChar: 0, endLine: 41, endChar: 12 },
			body: 'test',
			createdAt: '2026-06-29T00:00:00.000Z',
		};

		assert.strictEqual(formatLocation(thread), 'src/foo.ts:42');
	});

	test('formats multi-line location', () => {
		const thread: ReviewThread = {
			id: '1',
			file: 'src/foo.ts',
			range: { startLine: 41, startChar: 0, endLine: 43, endChar: 0 },
			body: 'test',
			createdAt: '2026-06-29T00:00:00.000Z',
		};

		assert.strictEqual(formatLocation(thread), 'src/foo.ts:42-44');
	});
});

suite('Review Markdown Export', () => {
	test('formats a single thread without title or separator', () => {
		const threads: ReviewThread[] = [
			{
				id: '1',
				file: 'core/shared/utils/errors.ts',
				range: { startLine: 54, startChar: 0, endLine: 58, endChar: 0 },
				body: 'comment content',
				createdAt: '2026-06-29T00:00:00.000Z',
			},
		];

		assert.strictEqual(
			commentsToMarkdown(threads),
			'## core/shared/utils/errors.ts:55-59\n\ncomment content\n',
		);
	});

	test('formats multiple threads with separators only', () => {
		const threads: ReviewThread[] = [
			{
				id: '1',
				file: 'src/a.ts',
				range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
				body: 'first',
				createdAt: '2026-06-29T00:00:00.000Z',
			},
			{
				id: '2',
				file: 'src/b.ts',
				range: { startLine: 1, startChar: 0, endLine: 1, endChar: 0 },
				body: 'second',
				createdAt: '2026-06-29T00:00:00.000Z',
			},
		];

		assert.strictEqual(
			commentsToMarkdown(threads),
			'## src/a.ts:1\n\nfirst\n\n---\n\n## src/b.ts:2\n\nsecond\n',
		);
	});

	test('returns empty string when there are no threads', () => {
		assert.strictEqual(commentsToMarkdown([]), '');
	});

	test('includes replies under the root comment', () => {
		const threads: ReviewThread[] = [
			{
				id: '1',
				file: 'src/a.ts',
				range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
				body: 'please fix',
				createdAt: '2026-06-29T00:00:00.000Z',
				replies: [
					{
						id: 'r1',
						body: 'fixed in next commit',
						author: 'Agent',
						createdAt: '2026-06-29T01:00:00.000Z',
					},
				],
			},
		];

		assert.strictEqual(
			commentsToMarkdown(threads),
			'## src/a.ts:1\n\nplease fix\n\n### Agent\n\nfixed in next commit\n',
		);
	});

	test('normalizes legacy You author to User in markdown export', () => {
		const threads: ReviewThread[] = [
			{
				id: '1',
				file: 'src/a.ts',
				range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
				body: 'please fix',
				createdAt: '2026-06-29T00:00:00.000Z',
				replies: [
					{
						id: 'r1',
						body: 'also check tests',
						author: 'User',
						createdAt: '2026-06-29T01:00:00.000Z',
					},
				],
			},
		];

		assert.strictEqual(
			commentsToMarkdown(threads),
			'## src/a.ts:1\n\nplease fix\n\n### User\n\nalso check tests\n',
		);
	});
});

suite('Review range tracking', () => {
	test('shifts range down when lines are inserted above', () => {
		const range = { startLine: 10, startChar: 0, endLine: 10, endChar: 4 };
		const next = applyContentChangesToRange(range, [change(5, 0, 5, 0, '\n')]);
		assert.deepStrictEqual(next, { startLine: 11, startChar: 0, endLine: 11, endChar: 4 });
	});

	test('shifts range up when lines are deleted above', () => {
		const range = { startLine: 10, startChar: 0, endLine: 10, endChar: 4 };
		const next = applyContentChangesToRange(range, [change(5, 0, 7, 0, '')]);
		assert.deepStrictEqual(next, { startLine: 8, startChar: 0, endLine: 8, endChar: 4 });
	});

	test('adjusts character offset on same-line edit before range', () => {
		const range = { startLine: 0, startChar: 10, endLine: 0, endChar: 12 };
		const next = applyContentChangesToRange(range, [change(0, 0, 0, 0, 'abc')]);
		assert.deepStrictEqual(next, { startLine: 0, startChar: 13, endLine: 0, endChar: 15 });
	});
});
