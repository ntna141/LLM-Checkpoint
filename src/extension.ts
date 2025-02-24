import * as vscode from 'vscode';
import { FileVersionDB } from './db';
import { initializeDatabase } from './db/schema';
import { VersionTreeProvider, exportVersionToFile, viewVersion, registerVersionProvider, appendVersionToFile } from './versionTreeProvider';
import { VersionRecord } from './db/schema';
import { VersionTreeItem } from './versionTreeProvider';
import { SettingsManager } from './settings';
import path from 'path';

let fileVersionDB: FileVersionDB;
let versionTreeProvider: VersionTreeProvider;
let settingsManager: SettingsManager;

export async function activate(context: vscode.ExtensionContext) {

	try {
		
		const db = await initializeDatabase(context);
		fileVersionDB = new FileVersionDB(db, context);
		settingsManager = new SettingsManager(context);
		
		versionTreeProvider = new VersionTreeProvider(fileVersionDB);
		const treeView = vscode.window.createTreeView('llmcheckpointVersions', {
			treeDataProvider: versionTreeProvider,
			showCollapseAll: false
		});
		versionTreeProvider.setTreeView(treeView);
		versionTreeProvider.setupEditorTracking();

		
		registerVersionProvider(context);
		const commands = [
			vscode.commands.registerCommand('llmcheckpoint.saveVersion', async () => {
				await saveCurrentVersion();
			}),
			vscode.commands.registerCommand('llmcheckpoint.showVersionHistory', showVersionHistory),
			vscode.commands.registerCommand('llmcheckpoint.restoreVersion', restoreVersion),
			vscode.commands.registerCommand('llmcheckpoint.viewVersion', (version) => {
				return viewVersion(version, fileVersionDB);
			}),
			vscode.commands.registerCommand('llmcheckpoint.exportVersion', (item: VersionTreeItem) => {
				if (item.version) {
					exportVersion(item.version);
				} else {
					vscode.window.showErrorMessage('No version information found');
				}
			}),
			vscode.commands.registerCommand('llmcheckpoint.deleteVersion', (item: VersionTreeItem) => {
				if (item.version) {
					deleteVersion(item.version);
				}
			}),
			vscode.commands.registerCommand('llmcheckpoint.openSettings', () => {
				settingsManager.showSettingsUI();
			}),
			vscode.commands.registerCommand('llmcheckpoint.appendVersion', (item: VersionTreeItem) => {
				if (item.version) {
					appendVersion(item.version);
				} else {
					vscode.window.showErrorMessage('No version information found');
				}
			})
		];

		const watcher = vscode.workspace.createFileSystemWatcher('**/*');
		
		
		const onSaveDisposable = vscode.workspace.onWillSaveTextDocument(async (e) => {
			try {
				const relativePath = vscode.workspace.asRelativePath(e.document.uri);
				const content = e.document.getText();

				let file = fileVersionDB.getFile(relativePath);
				if (!file) {
					file = fileVersionDB.createFile(relativePath);
				}

				const versions = fileVersionDB.getFileVersions(file.id, 1);
				if (versions.length > 0 && versions[0].content === content) {
					return;
				}

				setTimeout(() => {
					versionTreeProvider.refresh(relativePath);
				}, 100);
			} catch (error) {
				console.error('Error in save handler:', error);
			}
		});

		
		const fileWatcherDisposable = watcher.onDidChange(async (uri) => {
			const openTextDocuments = vscode.workspace.textDocuments;
			if (openTextDocuments.some(doc => doc.uri.toString() === uri.toString())) {
				await handleFileChange(uri);
				versionTreeProvider.refresh();
			}
		});

		
		context.subscriptions.push(
			...commands,
			fileWatcherDisposable,
			onSaveDisposable,  
			watcher,
			treeView,
			versionTreeProvider
		);

		console.log('LLMCheckpoint extension activated successfully!');
		vscode.window.showInformationMessage('LLM Checkpoint is now active');
	} catch (error) {
		console.error('Error activating LLMCheckpoint:', error);
		vscode.window.showErrorMessage('Failed to activate LLM Checkpoint: ' + error);
	}
}

async function handleFileChange(uri: vscode.Uri) {
	try {
		versionTreeProvider.refresh();
	} catch (error) {
		console.error('Error handling file change:', error);
	}
}

async function saveCurrentVersion() {
	try {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('No active editor');
			return;
		}

		const document = editor.document;
		if (!document.isDirty) {
			vscode.window.showInformationMessage('No changes to save');
			return;
		}

		const relativePath = vscode.workspace.asRelativePath(document.uri);
		const content = document.getText();

		let file = fileVersionDB.getFile(relativePath);
		if (!file) {
			file = fileVersionDB.createFile(relativePath);
		}

		const version = fileVersionDB.createVersion(file.id, content);
		
		versionTreeProvider.refresh(relativePath);
		vscode.window.showInformationMessage(`Version ${version.version_number} saved`);

	} catch (error) {
		console.error('Error saving version:', error);
		vscode.window.showErrorMessage(`Failed to save version: ${error}`);
	}
}

async function showVersionHistory() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('No active editor');
		return;
	}

	const document = editor.document;
	const relativePath = vscode.workspace.asRelativePath(document.uri);
	const file = fileVersionDB.getFile(relativePath);
	
	if (!file) {
		vscode.window.showWarningMessage('No version history found for this file');
		return;
	}

	const versions = fileVersionDB.getFileVersions(file.id);
	if (versions.length === 0) {
		vscode.window.showInformationMessage('No versions found for this file');
		return;
	}

	const items = versions.map(v => ({
		label: `Version ${v.version_number}`,
		description: new Date(v.timestamp).toLocaleString(),
		version: v
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a version to view or restore'
	});

	if (selected) {
		const uri = vscode.Uri.file(relativePath);
		const doc = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(doc);
		
		
		const originalContent = selected.version.content;
		const tempUri = uri.with({ scheme: 'untitled', path: `${relativePath}-v${selected.version.version_number}` });
		const tempDoc = await vscode.workspace.openTextDocument(tempUri);
		await vscode.window.showTextDocument(tempDoc, { viewColumn: vscode.ViewColumn.Beside });
		await vscode.window.activeTextEditor?.edit(editBuilder => {
			const fullRange = new vscode.Range(
				tempDoc.positionAt(0),
				tempDoc.positionAt(tempDoc.getText().length)
			);
			editBuilder.replace(fullRange, originalContent);
		});
	}
}

async function restoreVersion() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('No active editor');
		return;
	}

	const document = editor.document;
	const relativePath = vscode.workspace.asRelativePath(document.uri);
	const file = fileVersionDB.getFile(relativePath);
	
	if (!file) {
		vscode.window.showWarningMessage('No version history found for this file');
		return;
	}

	const versions = fileVersionDB.getFileVersions(file.id);
	const items = versions.map(v => ({
		label: `Version ${v.version_number}`,
		description: new Date(v.timestamp).toLocaleString(),
		version: v
	}));

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a version to restore'
	});

	if (selected) {
		const edit = new vscode.WorkspaceEdit();
		const uri = document.uri;
		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(document.getText().length)
		);
		edit.replace(uri, fullRange, selected.version.content);
		await vscode.workspace.applyEdit(edit);
		vscode.window.showInformationMessage(`Restored to version ${selected.version.version_number}`);
	}
}

async function exportVersion(version: VersionRecord) {
	try {
		const file = fileVersionDB.getFileById(version.file_id);
		if (!file) {
			throw new Error(`File not found for file_id: ${version.file_id}`);
		}
		
		const exportPath = await settingsManager.getHistoryPath();
		await exportVersionToFile(version, exportPath);
		vscode.window.showInformationMessage(`Version exported to ${exportPath}`);
	} catch (error: any) {
		console.error('Export error details:', {
			error: error.message,
			stack: error.stack,
			version: version
		});
		vscode.window.showErrorMessage(`Failed to export version: ${error.message}`);
	}
}

async function deleteVersion(version: VersionRecord) {
	try {
		const edit = new vscode.WorkspaceEdit();
		fileVersionDB.deleteVersion(version.id);
		versionTreeProvider.refresh();
		vscode.window.showInformationMessage(`Version ${version.version_number} deleted`);
	} catch (error: any) {
		const errorMessage = error?.message || 'Unknown error occurred';
		vscode.window.showErrorMessage('Failed to delete version: ' + errorMessage);
	}
}

async function appendVersion(version: VersionRecord) {
	try {
		const file = fileVersionDB.getFileById(version.file_id);
		if (!file) {
			throw new Error(`File not found for file_id: ${version.file_id}`);
		}
		
		const exportPath = await settingsManager.getHistoryPath();
		await appendVersionToFile(version, exportPath);
		vscode.window.showInformationMessage(`Version appended to ${exportPath}`);
	} catch (error: any) {
		console.error('Append error details:', {
			error: error.message,
			stack: error.stack,
			version: version
		});
		vscode.window.showErrorMessage(`Failed to append version: ${error.message}`);
	}
}

export function deactivate() {
	
}
