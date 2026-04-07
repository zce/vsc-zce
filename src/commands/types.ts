import * as vscode from 'vscode';

export interface FolderContextCommand {
	id: string;
	title: string;
	run(folder: vscode.Uri): Promise<void>;
}
