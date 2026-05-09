import * as vscode from 'vscode';
import { ExtensionModule } from './module';
import { DotnetModule } from './modules/dotnet';
import { EditorModule } from './modules/editor';

const modules: ExtensionModule[] = [
	new DotnetModule(),
	new EditorModule(),
];

export function activate(context: vscode.ExtensionContext) {
	for (const module of modules) {
		module.activate(context);
	}
}

export function deactivate() {
	for (const module of modules) {
		module.deactivate?.();
	}
}
