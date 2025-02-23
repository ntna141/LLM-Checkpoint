import * as vscode from 'vscode';
import { FileVersionDB } from './db';
import { initializeDatabase } from './db/schema';
import { VersionTreeProvider, exportVersionToFile, viewVersion, registerVersionProvider } from './versionTreeProvider';
import { VersionRecord } from './db/schema';
import { VersionTreeItem } from './versionTreeProvider';

let fileVersionDB: FileVersionDB;
let versionTreeProvider: VersionTreeProvider;

export async function activate(context: vscode.ExtensionContext) {
	console.log('Starting LLMCheckpoint activation...');

	try {
		
		console.log('Initializing database...');
		const db = await initializeDatabase(context);
		fileVersionDB = new FileVersionDB(db, context);
		console.log('Database initialized successfully');

		
		console.log('Setting up tree view provider...');
		versionTreeProvider = new VersionTreeProvider(fileVersionDB);
		const treeView = vscode.window.createTreeView('llmcheckpointVersions', {
			treeDataProvider: versionTreeProvider,
			showCollapseAll: true
		});
		console.log('Tree view provider created');

		
		registerVersionProvider(context);
		console.log('Version content provider registered');

		
		console.log('Registering commands...');
		const commands = [
			vscode.commands.registerCommand('llmcheckpoint.saveVersion', saveCurrentVersion),
			vscode.commands.registerCommand('llmcheckpoint.showVersionHistory', showVersionHistory),
			vscode.commands.registerCommand('llmcheckpoint.restoreVersion', restoreVersion),
			vscode.commands.registerCommand('llmcheckpoint.viewVersion', (version) => {
				console.log('View command triggered with:', version);
				return viewVersion(version, fileVersionDB);
			}),
			vscode.commands.registerCommand('llmcheckpoint.exportVersion', exportVersion),
			vscode.commands.registerCommand('llmcheckpoint.deleteVersion', (item: VersionTreeItem) => {
				if (item.version) {
					deleteVersion(item.version);
				}
			}),
			vscode.commands.registerCommand('llmcheckpoint.refreshVersions', () => {
				console.log('Refreshing versions view...');
				versionTreeProvider.refresh();
			})
		];
		console.log('Commands registered');

		
		console.log('Setting up file watcher...');
		const watcher = vscode.workspace.createFileSystemWatcher('**/*');
		
		
		const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
			console.log(`File saved: ${document.uri.toString()}`);
			await handleFileChange(document.uri);
			versionTreeProvider.refresh();
		});

		
		const fileWatcherDisposable = watcher.onDidChange(async (uri) => {
			console.log(`File changed: ${uri.toString()}`);
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
			treeView
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
		console.log('Handling file change for:', uri.toString());
		const document = await vscode.workspace.openTextDocument(uri);
		
		
		if (!document.isDirty) {
			console.log('Document is not dirty, skipping version creation');
			return;
		}

		const relativePath = vscode.workspace.asRelativePath(uri);
		const content = document.getText();

		
		if (!content || typeof content !== 'string') {
			console.log('Invalid content, skipping version creation');
			return;
		}

		let file = fileVersionDB.getFile(relativePath);
		if (!file) {
			file = fileVersionDB.createFile(relativePath);
		}

		
		const versions = fileVersionDB.getFileVersions(file.id);
		const latestVersion = versions[versions.length - 1];

		if (latestVersion) {
			
			if (latestVersion.content === content) {
				console.log('No actual changes detected, skipping version creation');
				return;
			}
		}

		console.log('Creating new version for file:', relativePath);
		const version = fileVersionDB.createVersion(file.id, content);
		console.log(`Created version ${version.version_number} for file:`, relativePath);
		versionTreeProvider.refresh();

	} catch (error) {
		console.error('Error handling file change:', error);
		vscode.window.showErrorMessage(`Failed to save version: ${error}`);
	}
}

async function saveCurrentVersion() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('No active editor');
		return;
	}

	const document = editor.document;
	const relativePath = vscode.workspace.asRelativePath(document.uri);
	const content = document.getText();

	let file = fileVersionDB.getFile(relativePath);
	if (!file) {
		file = fileVersionDB.createFile(relativePath);
	}

	const version = fileVersionDB.createVersion(file.id, content);
	vscode.window.showInformationMessage(`Version ${version.version_number} saved`);
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
		await exportVersionToFile(version, 'history_context.txt');
		vscode.window.showInformationMessage('Version exported to history_context.txt');
	} catch (error: any) {
		const errorMessage = error?.message || 'Unknown error occurred';
		vscode.window.showErrorMessage('Failed to export version: ' + errorMessage);
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

export function deactivate() {
	
}
