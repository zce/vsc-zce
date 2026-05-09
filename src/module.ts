import * as vscode from 'vscode';

export interface ExtensionModule {
	activate(context: vscode.ExtensionContext): void;
	deactivate?(): void;
}
