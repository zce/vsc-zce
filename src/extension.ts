import * as vscode from 'vscode';
import { createDotnetFolderCommands } from './commands/dotnetFolderCommands';
import { FolderContextCommand } from './commands/types';
import { TerminalCommandRunner } from './services/terminalCommandRunner';
import { UpwardFolderLocator } from './services/upwardFolderLocator';

export function activate(context: vscode.ExtensionContext) {
	const runner = new TerminalCommandRunner();
	const folderLocator = new UpwardFolderLocator();
	const folderCommands = createDotnetFolderCommands(runner, folderLocator);

	registerFolderContextCommands(context, folderCommands);
}

export function deactivate() {}

function registerFolderContextCommands(
	context: vscode.ExtensionContext,
	commands: FolderContextCommand[],
): void {
	for (const command of commands) {
		const disposable = vscode.commands.registerCommand(
			command.id,
			async (resource?: vscode.Uri) => {
				if (!resource) {
					void vscode.window.showWarningMessage('Please select a folder in Explorer.');
					return;
				}

				await command.run(resource);
			},
		);

		context.subscriptions.push(disposable);
	}
}
