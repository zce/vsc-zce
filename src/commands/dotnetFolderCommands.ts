import * as vscode from 'vscode';
import { FolderContextCommand } from './types';
import { TerminalCommandRunner } from '../services/terminalCommandRunner';
import { UpwardFolderLocator } from '../services/upwardFolderLocator';

interface DotnetCommandDefinition {
	id: string;
	title: string;
	command: string;
}

const DOTNET_COMMANDS: DotnetCommandDefinition[] = [
	{
		id: 'zce.dotnet.restore',
		title: 'dotnet restore',
		command: 'dotnet restore',
	},
	{
		id: 'zce.dotnet.build',
		title: 'dotnet build',
		command: 'dotnet build',
	},
	{
		id: 'zce.dotnet.clean',
		title: 'dotnet clean',
		command: 'dotnet clean',
	},
	{
		id: 'zce.dotnet.test',
		title: 'dotnet test',
		command: 'dotnet test',
	},
];

export function createDotnetFolderCommands(
	runner: TerminalCommandRunner,
	folderLocator: UpwardFolderLocator,
): FolderContextCommand[] {
	return DOTNET_COMMANDS.map((definition) => ({
		id: definition.id,
		title: definition.title,
		run: async (folder: vscode.Uri) => {
			if (folder.scheme !== 'file') {
				void vscode.window.showErrorMessage('Only local folders are supported.');
				return;
			}

			const projectFolder = await folderLocator.findNearestFolderContaining(
				folder,
				(entryName) => entryName.toLowerCase().endsWith('.csproj'),
			);

			runner.runInFolder(definition.command, projectFolder ?? folder);
		},
	}));
}
