import * as path from 'node:path';
import * as vscode from 'vscode';

export class TerminalCommandRunner {
	runInFolder(command: string, folder: vscode.Uri): void {
		const terminalName = `ZCE .NET (${path.basename(folder.fsPath)})`;
		const terminal = vscode.window.createTerminal({
			name: terminalName,
			cwd: folder.fsPath,
		});

		terminal.show(true);
		terminal.sendText(command, true);
	}
}
