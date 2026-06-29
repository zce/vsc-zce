import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getStoragePathForFolder } from './config';
import { rangesEqual } from './rangeTracking';
import { ReviewDocument, ReviewRange, ReviewThread } from './types';

export class ReviewStorage {
	private readonly listeners = new Set<() => void>();
	private readonly cacheByFolder = new Map<string, ReviewThread[]>();
	private readonly threadById = new Map<string, ReviewThread>();

	onDidChange(listener: () => void): vscode.Disposable {
		this.listeners.add(listener);
		return new vscode.Disposable(() => this.listeners.delete(listener));
	}

	clearCache(): void {
		this.cacheByFolder.clear();
		this.threadById.clear();
	}

	invalidateFolder(workspaceFolder: vscode.WorkspaceFolder): void {
		const key = this.folderKey(workspaceFolder);
		const cached = this.cacheByFolder.get(key);
		if (!cached) {
			return;
		}

		for (const thread of cached) {
			this.threadById.delete(thread.id);
		}

		this.cacheByFolder.delete(key);
	}

	async refreshFromDisk(notify = true): Promise<void> {
		this.clearCache();
		await this.loadAll();
		if (notify) {
			this.fireChange();
		}
	}

	async refreshFolderFromDisk(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
		this.invalidateFolder(workspaceFolder);
		await this.loadForFolder(workspaceFolder);
		this.fireChange();
	}

	private fireChange(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	private folderKey(workspaceFolder: vscode.WorkspaceFolder): string {
		return workspaceFolder.uri.toString();
	}

	private getStoragePath(workspaceFolder: vscode.WorkspaceFolder): string {
		return getStoragePathForFolder(workspaceFolder);
	}

	private indexFolderThreads(threads: readonly ReviewThread[]): void {
		for (const thread of threads) {
			this.threadById.set(thread.id, thread);
		}
	}

	private parseStoredComments(raw: unknown): ReviewThread[] {
		if (Array.isArray(raw)) {
			return raw as ReviewThread[];
		}

		if (raw && typeof raw === 'object' && 'comments' in raw) {
			return (raw as ReviewDocument).comments ?? [];
		}

		return [];
	}

	findWorkspaceFolderForRelativePath(
		relativePath: string,
	): vscode.WorkspaceFolder | undefined {
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const absolutePath = path.join(folder.uri.fsPath, relativePath);
			try {
				if (existsSync(absolutePath)) {
					return folder;
				}
			} catch {
				// ignore
			}
		}

		return vscode.workspace.workspaceFolders?.[0];
	}

	resolveWorkspaceFolder(thread: ReviewThread): vscode.WorkspaceFolder | undefined {
		return this.findWorkspaceFolderForRelativePath(thread.file);
	}

	async loadAll(): Promise<ReviewThread[]> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders?.length) {
			return [];
		}

		const threads: ReviewThread[] = [];
		for (const folder of folders) {
			threads.push(...(await this.loadForFolder(folder)));
		}

		return threads.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}

	async loadForFolder(workspaceFolder: vscode.WorkspaceFolder): Promise<ReviewThread[]> {
		const key = this.folderKey(workspaceFolder);
		const cached = this.cacheByFolder.get(key);
		if (cached) {
			return cached;
		}

		const storagePath = this.getStoragePath(workspaceFolder);

		try {
			const raw = await fs.readFile(storagePath, 'utf8');
			const parsed = JSON.parse(raw) as unknown;
			const comments = this.parseStoredComments(parsed);
			this.cacheByFolder.set(key, comments);
			this.indexFolderThreads(comments);
			return comments;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				const comments: ReviewThread[] = [];
				this.cacheByFolder.set(key, comments);
				return comments;
			}
			throw error;
		}
	}

	async saveForFolder(
		workspaceFolder: vscode.WorkspaceFolder,
		threads: ReviewThread[],
	): Promise<void> {
		const key = this.folderKey(workspaceFolder);
		const previous = this.cacheByFolder.get(key);
		if (previous) {
			for (const thread of previous) {
				this.threadById.delete(thread.id);
			}
		}

		this.cacheByFolder.set(key, threads);
		this.indexFolderThreads(threads);

		const storagePath = this.getStoragePath(workspaceFolder);
		await fs.mkdir(path.dirname(storagePath), { recursive: true });

		const payload: ReviewDocument = { comments: threads };
		await fs.writeFile(storagePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
		this.fireChange();
	}

	async addThread(thread: ReviewThread, documentUri: vscode.Uri): Promise<void> {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
		if (!workspaceFolder) {
			throw new Error('File is not inside a workspace folder.');
		}

		const threads = await this.loadForFolder(workspaceFolder);
		threads.unshift(thread);
		await this.saveForFolder(workspaceFolder, threads);
	}

	async removeThread(thread: ReviewThread): Promise<void> {
		const workspaceFolder = this.resolveWorkspaceFolder(thread);
		if (!workspaceFolder) {
			return;
		}

		const threads = await this.loadForFolder(workspaceFolder);
		const nextThreads = threads.filter((item) => item.id !== thread.id);
		await this.saveForFolder(workspaceFolder, nextThreads);
	}

	async updateThread(thread: ReviewThread): Promise<void> {
		const workspaceFolder = this.resolveWorkspaceFolder(thread);
		if (!workspaceFolder) {
			return;
		}

		const threads = await this.loadForFolder(workspaceFolder);
		const index = threads.findIndex((item) => item.id === thread.id);
		if (index === -1) {
			return;
		}

		threads[index] = thread;
		await this.saveForFolder(workspaceFolder, threads);
	}

	findById(id: string): ReviewThread | undefined {
		return this.threadById.get(id);
	}

	async ensureThreadLoaded(id: string): Promise<ReviewThread | undefined> {
		const cached = this.findById(id);
		if (cached) {
			return cached;
		}

		await this.loadAll();
		return this.findById(id);
	}

	async loadForFile(relativePath: string): Promise<ReviewThread[]> {
		const workspaceFolder = this.findWorkspaceFolderForRelativePath(relativePath);
		if (!workspaceFolder) {
			return [];
		}

		const threads = await this.loadForFolder(workspaceFolder);
		return threads.filter((thread) => thread.file === relativePath);
	}

	async resolveAllInFile(relativePath: string): Promise<number> {
		const workspaceFolder = this.findWorkspaceFolderForRelativePath(relativePath);
		if (!workspaceFolder) {
			return 0;
		}

		const threads = await this.loadForFolder(workspaceFolder);
		let changed = 0;
		const nextThreads = threads.map((thread) => {
			if (thread.file !== relativePath || thread.resolved) {
				return thread;
			}

			changed += 1;
			return {
				...thread,
				resolved: true,
				resolvedAt: new Date().toISOString(),
			};
		});

		if (changed === 0) {
			return 0;
		}

		await this.saveForFolder(workspaceFolder, nextThreads);
		return changed;
	}

	async updateThreadRangesForFile(
		relativePath: string,
		rangesById: ReadonlyMap<string, ReviewRange>,
	): Promise<boolean> {
		const workspaceFolder = this.findWorkspaceFolderForRelativePath(relativePath);
		if (!workspaceFolder) {
			return false;
		}

		const threads = await this.loadForFolder(workspaceFolder);
		let changed = false;
		const next = threads.map((thread) => {
			if (thread.file !== relativePath) {
				return thread;
			}

			const range = rangesById.get(thread.id);
			if (!range || rangesEqual(thread.range, range)) {
				return thread;
			}

			changed = true;
			return { ...thread, range };
		});

		if (!changed) {
			return false;
		}

		await this.saveForFolder(workspaceFolder, next);
		return true;
	}

	async deleteAllInFile(relativePath: string): Promise<number> {
		const workspaceFolder = this.findWorkspaceFolderForRelativePath(relativePath);
		if (!workspaceFolder) {
			return 0;
		}

		const threads = await this.loadForFolder(workspaceFolder);
		const remaining = threads.filter((thread) => thread.file !== relativePath);
		const removed = threads.length - remaining.length;
		if (removed === 0) {
			return 0;
		}

		await this.saveForFolder(workspaceFolder, remaining);
		return removed;
	}

	toRelativePath(documentUri: vscode.Uri): string {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
		if (workspaceFolder) {
			return vscode.workspace.asRelativePath(documentUri, false);
		}
		return documentUri.fsPath;
	}

	toAbsolutePath(thread: ReviewThread, workspaceFolder: vscode.WorkspaceFolder): string {
		return path.join(workspaceFolder.uri.fsPath, thread.file);
	}
}
