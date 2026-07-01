import * as vscode from 'vscode';

export async function whenWorkspaceReady(): Promise<void> {
	if (vscode.workspace.workspaceFolders?.length) {
		return;
	}

	await new Promise<void>((resolve) => {
		const disposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
			if (vscode.workspace.workspaceFolders?.length) {
				disposable.dispose();
				resolve();
			}
		});
	});
}
