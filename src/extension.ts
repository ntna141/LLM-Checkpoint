import * as vscode from 'vscode';
import { FileVersionDB } from './db';
import { initializeDatabase } from './db/schema';
import { VersionTreeProvider, exportVersionToFile, viewVersion, registerVersionProvider, appendVersionToFile, initializeProviders } from './versionTreeProvider';
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
		
		initializeProviders(fileVersionDB, settingsManager);
		
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

				const saveAllChanges = await settingsManager.getSaveAllChanges();

				if (!saveAllChanges) {
					const versions = fileVersionDB.getFileVersions(file.id, 1);
					if (versions.length > 0) {
						const previousContent = versions[0].content;
						if (previousContent === content) {
							return;
						}

						const previousLines = previousContent.split('\n');
						const currentLines = content.split('\n');

						let changedLines = 0;
						const maxLines = Math.max(previousLines.length, currentLines.length);
						for (let i = 0; i < maxLines; i++) {
							if (previousLines[i] !== currentLines[i]) {
								changedLines++;
								if (changedLines > 1) {
									break;
								}
							}
						}

						if (changedLines <= 1) {
							return;
						}
					}
				} else {
					
					const versions = fileVersionDB.getFileVersions(file.id, 1);
					if (versions.length > 0 && versions[0].content === content) {
						return;
					}
				}
				fileVersionDB.createVersion(file.id, content);
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
	} catch (error) {
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

async function exportVersion(version: VersionRecord) {
	try {
		const exportPath = await settingsManager.getHistoryPath();
		await exportVersionToFile(version, exportPath);
	} catch (error: any) {
		console.error('Set context error details:', {
			error: error.message,
			stack: error.stack,
			version: version
		});
		vscode.window.showErrorMessage(`Failed to set new context: ${error.message}`);
	}
}

async function deleteVersion(version: VersionRecord) {
	try {
		const edit = new vscode.WorkspaceEdit();
		fileVersionDB.deleteVersion(version.id);
		versionTreeProvider.refresh();
		await settingsManager.showConditionalInfoMessage('Version deleted successfully');
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
	} catch (error: any) {
		console.error('Append error details:', {
			error: error.message,
			stack: error.stack,
			version: version
		});
		vscode.window.showErrorMessage(`Failed to append version: ${error.message}`);
	}
}