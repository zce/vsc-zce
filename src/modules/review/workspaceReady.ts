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

export async function revealCommentsPanel(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.focusCommentsPanel');
}

export function scheduleStartupRetries(task: () => void | Promise<void>): vscode.Disposable {
	const delays = [0, 250, 1000];
	const timers = delays.map((delay) =>
		setTimeout(() => {
			void task();
		}, delay),
	);

	return new vscode.Disposable(() => {
		for (const timer of timers) {
			clearTimeout(timer);
		}
	});
}
