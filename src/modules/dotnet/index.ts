import * as vscode from 'vscode';
import { ExtensionModule } from '../../module';
import { TerminalCommandRunner } from './terminalCommandRunner';
import { UpwardFolderLocator } from './upwardFolderLocator';

export interface ICommandRunner {
	runInFolder(command: string, folder: vscode.Uri): void;
}

export interface IFolderLocator {
	findNearestFolderContaining(
		startFolder: vscode.Uri,
		matcher: (entryName: string) => boolean,
	): Promise<vscode.Uri | undefined>;
}

interface DotnetCommand {
	id: string;
	title: string;
	run(folder: vscode.Uri): Promise<void>;
}

interface DotnetCommandDefinition {
	id: string;
	title: string;
	command: string;
}

const DOTNET_COMMANDS: DotnetCommandDefinition[] = [
	{ id: 'zce.dotnet.restore', title: 'dotnet restore', command: 'dotnet restore' },
	{ id: 'zce.dotnet.build',   title: 'dotnet build',   command: 'dotnet build'   },
	{ id: 'zce.dotnet.clean',   title: 'dotnet clean',   command: 'dotnet clean'   },
	{ id: 'zce.dotnet.test',    title: 'dotnet test',    command: 'dotnet test'    },
];

export function createDotnetCommands(
	runner: ICommandRunner,
	locator: IFolderLocator,
): DotnetCommand[] {
	return DOTNET_COMMANDS.map((definition) => ({
		id: definition.id,
		title: definition.title,
		run: async (folder: vscode.Uri) => {
			if (folder.scheme !== 'file') {
				void vscode.window.showErrorMessage('Only local folders are supported.');
				return;
			}

			const projectFolder = await locator.findNearestFolderContaining(
				folder,
				(entryName) => entryName.toLowerCase().endsWith('.csproj'),
			);

			runner.runInFolder(definition.command, projectFolder ?? folder);
		},
	}));
}

export class DotnetModule implements ExtensionModule {
	private readonly runner = new TerminalCommandRunner();
	private readonly folderLocator = new UpwardFolderLocator();

	activate(context: vscode.ExtensionContext): void {
		const commands = createDotnetCommands(this.runner, this.folderLocator);

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
}
