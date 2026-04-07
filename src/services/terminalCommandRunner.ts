import { spawn } from 'node:child_process';
import * as vscode from 'vscode';

export class TerminalCommandRunner {
	private readonly output = vscode.window.createOutputChannel('ZCE .NET');

	runInFolder(command: string, folder: vscode.Uri): Promise<void> {
		return new Promise((resolve) => {
			const status = vscode.window.setStatusBarMessage(
				`$(sync~spin) ZCE .NET running: ${command}`,
			);
			this.output.show(true);
			this.output.appendLine('');
			this.output.appendLine(`> ${command}`);
			this.output.appendLine(`cwd: ${folder.fsPath}`);
			this.output.appendLine('');

			const child = spawn(command, {
				cwd: folder.fsPath,
				shell: true,
			});

			child.stdout.on('data', (chunk: Buffer | string) => {
				this.output.append(String(chunk));
			});

			child.stderr.on('data', (chunk: Buffer | string) => {
				this.output.append(String(chunk));
			});

			child.on('close', (code) => {
				status.dispose();
				if (code === 0) {
					this.output.appendLine('');
					this.output.appendLine(`Done: ${command}`);
					void vscode.window.showInformationMessage(`${command} completed.`);
				} else {
					this.output.appendLine('');
					this.output.appendLine(`Failed (exit code ${code ?? -1}): ${command}`);
					this.output.show(true);
					void vscode.window.showErrorMessage(
						`${command} failed (exit code ${code ?? -1}). See Output: ZCE .NET.`,
					);
				}

				resolve();
			});

			child.on('error', (error) => {
				status.dispose();
				this.output.appendLine(`Failed to start command: ${error.message}`);
				this.output.show(true);
				void vscode.window.showErrorMessage(
					`Failed to start ${command}. See Output: ZCE .NET.`,
				);
				resolve();
			});
		});
	}
}
