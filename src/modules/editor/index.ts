import * as vscode from 'vscode';
import { ExtensionModule } from '../../module';

export class EditorModule implements ExtensionModule {
	activate(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.commands.registerCommand('zce.copyLocation', async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					void vscode.window.showWarningMessage('No active editor.');
					return;
				}

				const { document, selection } = editor;

				const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
				const relativePath = workspaceFolder
					? vscode.workspace.asRelativePath(document.uri, false)
					: document.uri.fsPath;

				const startLine = selection.start.line + 1;
				const endLine = selection.end.line + 1;

				const location =
					selection.isEmpty || startLine === endLine
						? `${relativePath}:${startLine}`
						: `${relativePath}:${startLine}-${endLine}`;

				await vscode.env.clipboard.writeText(location);
				void vscode.window.showInformationMessage(`Copied: ${location}`);
			}),
		);
	}
}
