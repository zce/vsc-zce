import * as assert from 'assert';
import * as vscode from 'vscode';
import { createDotnetFolderCommands } from '../commands/dotnetFolderCommands';

suite('Dotnet Folder Commands', () => {
	test('uses selected folder when it already contains a .csproj', async () => {
		const selectedFolder = vscode.Uri.file('C:/repo/src/App');
		const locatorCalls: vscode.Uri[] = [];
		const runnerCalls: Array<{ command: string; folder: vscode.Uri }> = [];

		const runner = {
			runInFolder(command: string, folder: vscode.Uri) {
				runnerCalls.push({ command, folder });
			},
		};

		const locator = {
			async findNearestFolderContaining(startFolder: vscode.Uri) {
				locatorCalls.push(startFolder);
				return selectedFolder;
			},
		};

		const commands = createDotnetFolderCommands(
			runner as any,
			locator as any,
		);
		const buildCommand = commands.find((x) => x.id === 'zce.dotnet.build');
		assert.ok(buildCommand);

		await buildCommand!.run(selectedFolder);

		assert.strictEqual(locatorCalls.length, 1);
		assert.strictEqual(locatorCalls[0].fsPath, selectedFolder.fsPath);
		assert.strictEqual(runnerCalls.length, 1);
		assert.strictEqual(runnerCalls[0].command, 'dotnet build');
		assert.strictEqual(runnerCalls[0].folder.fsPath, selectedFolder.fsPath);
	});

	test('uses nearest parent folder when .csproj is found upward', async () => {
		const selectedFolder = vscode.Uri.file('C:/repo/src/App/bin');
		const nearestProjectFolder = vscode.Uri.file('C:/repo/src/App');
		let receivedMatcher: ((entryName: string) => boolean) | undefined;
		const runnerCalls: Array<{ command: string; folder: vscode.Uri }> = [];

		const runner = {
			runInFolder(command: string, folder: vscode.Uri) {
				runnerCalls.push({ command, folder });
			},
		};

		const locator = {
			async findNearestFolderContaining(
				_startFolder: vscode.Uri,
				matcher: (entryName: string) => boolean,
			) {
				receivedMatcher = matcher;
				return nearestProjectFolder;
			},
		};

		const commands = createDotnetFolderCommands(
			runner as any,
			locator as any,
		);
		const restoreCommand = commands.find((x) => x.id === 'zce.dotnet.restore');
		assert.ok(restoreCommand);

		await restoreCommand!.run(selectedFolder);

		assert.ok(receivedMatcher);
		assert.strictEqual(receivedMatcher!('MyApp.csproj'), true);
		assert.strictEqual(receivedMatcher!('README.md'), false);
		assert.strictEqual(runnerCalls.length, 1);
		assert.strictEqual(runnerCalls[0].command, 'dotnet restore');
		assert.strictEqual(runnerCalls[0].folder.fsPath, nearestProjectFolder.fsPath);
	});

	test('falls back to selected folder when no .csproj is found upward', async () => {
		const selectedFolder = vscode.Uri.file('C:/repo/tools/scripts');
		const runnerCalls: Array<{ command: string; folder: vscode.Uri }> = [];

		const runner = {
			runInFolder(command: string, folder: vscode.Uri) {
				runnerCalls.push({ command, folder });
			},
		};

		const locator = {
			async findNearestFolderContaining() {
				return undefined;
			},
		};

		const commands = createDotnetFolderCommands(
			runner as any,
			locator as any,
		);
		const cleanCommand = commands.find((x) => x.id === 'zce.dotnet.clean');
		assert.ok(cleanCommand);

		await cleanCommand!.run(selectedFolder);

		assert.strictEqual(runnerCalls.length, 1);
		assert.strictEqual(runnerCalls[0].command, 'dotnet clean');
		assert.strictEqual(runnerCalls[0].folder.fsPath, selectedFolder.fsPath);
	});

	test('runs dotnet test command', async () => {
		const selectedFolder = vscode.Uri.file('C:/repo/src/App');
		const runnerCalls: Array<{ command: string; folder: vscode.Uri }> = [];

		const runner = {
			runInFolder(command: string, folder: vscode.Uri) {
				runnerCalls.push({ command, folder });
			},
		};

		const locator = {
			async findNearestFolderContaining() {
				return selectedFolder;
			},
		};

		const commands = createDotnetFolderCommands(
			runner as any,
			locator as any,
		);
		const testCommand = commands.find((x) => x.id === 'zce.dotnet.test');
		assert.ok(testCommand);

		await testCommand!.run(selectedFolder);

		assert.strictEqual(runnerCalls.length, 1);
		assert.strictEqual(runnerCalls[0].command, 'dotnet test');
		assert.strictEqual(runnerCalls[0].folder.fsPath, selectedFolder.fsPath);
	});
});
