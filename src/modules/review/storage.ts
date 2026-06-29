import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getStoragePathForFolder } from './config';
import { rangesEqual } from './rangeTracking';
import { ReviewFile, ReviewNote, ReviewNoteRange } from './types';

export class ReviewStorage {
	private readonly listeners = new Set<() => void>();
	private readonly cacheByFolder = new Map<string, ReviewNote[]>();
	private readonly noteById = new Map<string, ReviewNote>();

	onDidChange(listener: () => void): vscode.Disposable {
		this.listeners.add(listener);
		return new vscode.Disposable(() => this.listeners.delete(listener));
	}

	clearCache(): void {
		this.cacheByFolder.clear();
		this.noteById.clear();
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

	private indexFolderNotes(notes: readonly ReviewNote[]): void {
		for (const note of notes) {
			this.noteById.set(note.id, note);
		}
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

	resolveWorkspaceFolder(note: ReviewNote): vscode.WorkspaceFolder | undefined {
		return this.findWorkspaceFolderForRelativePath(note.file);
	}

	async loadAll(): Promise<ReviewNote[]> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders?.length) {
			return [];
		}

		const notes: ReviewNote[] = [];
		for (const folder of folders) {
			notes.push(...(await this.loadForFolder(folder)));
		}

		return notes.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}

	async loadForFolder(workspaceFolder: vscode.WorkspaceFolder): Promise<ReviewNote[]> {
		const key = this.folderKey(workspaceFolder);
		const cached = this.cacheByFolder.get(key);
		if (cached) {
			return cached;
		}

		const storagePath = this.getStoragePath(workspaceFolder);

		try {
			const raw = await fs.readFile(storagePath, 'utf8');
			const parsed = JSON.parse(raw) as ReviewFile | ReviewNote[];
			const notes = Array.isArray(parsed) ? parsed : (parsed.notes ?? []);
			this.cacheByFolder.set(key, notes);
			this.indexFolderNotes(notes);
			return notes;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				const notes: ReviewNote[] = [];
				this.cacheByFolder.set(key, notes);
				return notes;
			}
			throw error;
		}
	}

	async saveForFolder(
		workspaceFolder: vscode.WorkspaceFolder,
		notes: ReviewNote[],
	): Promise<void> {
		const key = this.folderKey(workspaceFolder);
		const previous = this.cacheByFolder.get(key);
		if (previous) {
			for (const note of previous) {
				this.noteById.delete(note.id);
			}
		}

		this.cacheByFolder.set(key, notes);
		this.indexFolderNotes(notes);

		const storagePath = this.getStoragePath(workspaceFolder);
		await fs.mkdir(path.dirname(storagePath), { recursive: true });

		const payload: ReviewFile = { notes };
		await fs.writeFile(storagePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
		this.fireChange();
	}

	async addNote(note: ReviewNote, documentUri: vscode.Uri): Promise<void> {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
		if (!workspaceFolder) {
			throw new Error('File is not inside a workspace folder.');
		}

		const notes = await this.loadForFolder(workspaceFolder);
		notes.unshift(note);
		await this.saveForFolder(workspaceFolder, notes);
	}

	async removeNote(note: ReviewNote): Promise<void> {
		const workspaceFolder = this.resolveWorkspaceFolder(note);
		if (!workspaceFolder) {
			return;
		}

		const notes = await this.loadForFolder(workspaceFolder);
		const nextNotes = notes.filter((item) => item.id !== note.id);
		await this.saveForFolder(workspaceFolder, nextNotes);
	}

	async updateNote(note: ReviewNote): Promise<void> {
		const workspaceFolder = this.resolveWorkspaceFolder(note);
		if (!workspaceFolder) {
			return;
		}

		const notes = await this.loadForFolder(workspaceFolder);
		const index = notes.findIndex((item) => item.id === note.id);
		if (index === -1) {
			return;
		}

		notes[index] = note;
		await this.saveForFolder(workspaceFolder, notes);
	}

	findById(id: string): ReviewNote | undefined {
		return this.noteById.get(id);
	}

	async ensureNoteLoaded(id: string): Promise<ReviewNote | undefined> {
		const cached = this.findById(id);
		if (cached) {
			return cached;
		}

		await this.loadAll();
		return this.findById(id);
	}

	async loadForFile(relativePath: string): Promise<ReviewNote[]> {
		const workspaceFolder = this.findWorkspaceFolderForRelativePath(relativePath);
		if (!workspaceFolder) {
			return [];
		}

		const notes = await this.loadForFolder(workspaceFolder);
		return notes.filter((note) => note.file === relativePath);
	}

	async resolveAllInFile(relativePath: string): Promise<number> {
		const workspaceFolder = this.findWorkspaceFolderForRelativePath(relativePath);
		if (!workspaceFolder) {
			return 0;
		}

		const notes = await this.loadForFolder(workspaceFolder);
		let changed = 0;
		const nextNotes = notes.map((note) => {
			if (note.file !== relativePath || note.resolved) {
				return note;
			}

			changed += 1;
			return {
				...note,
				resolved: true,
				resolvedAt: new Date().toISOString(),
			};
		});

		if (changed === 0) {
			return 0;
		}

		await this.saveForFolder(workspaceFolder, nextNotes);
		return changed;
	}

	async updateNoteRangesForFile(
		relativePath: string,
		rangesById: ReadonlyMap<string, ReviewNoteRange>,
	): Promise<boolean> {
		const workspaceFolder = this.findWorkspaceFolderForRelativePath(relativePath);
		if (!workspaceFolder) {
			return false;
		}

		const notes = await this.loadForFolder(workspaceFolder);
		let changed = false;
		const next = notes.map((note) => {
			if (note.file !== relativePath) {
				return note;
			}

			const range = rangesById.get(note.id);
			if (!range || rangesEqual(note.range, range)) {
				return note;
			}

			changed = true;
			return { ...note, range };
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

		const notes = await this.loadForFolder(workspaceFolder);
		const remaining = notes.filter((note) => note.file !== relativePath);
		const removed = notes.length - remaining.length;
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

	toAbsolutePath(note: ReviewNote, workspaceFolder: vscode.WorkspaceFolder): string {
		return path.join(workspaceFolder.uri.fsPath, note.file);
	}
}
