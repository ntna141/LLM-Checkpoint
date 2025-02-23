// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { FileVersionDB } from './db';
import { initializeDatabase } from './db/schema';
import { VersionTreeProvider, exportVersionToFile } from './versionTreeProvider';
import { VersionRecord } from './db/schema';

let fileVersionDB: FileVersionDB;
let versionTreeProvider: VersionTreeProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	console.log('Starting LLMCheckpoint activation...');

	try {
		// Initialize database
		console.log('Initializing database...');
		const db = await initializeDatabase(context);
		fileVersionDB = new FileVersionDB(db, context);
		console.log('Database initialized successfully');

		// Create and register the tree view provider
		console.log('Setting up tree view provider...');
		versionTreeProvider = new VersionTreeProvider(fileVersionDB);
		const treeView = vscode.window.createTreeView('llmcheckpointVersions', {
			treeDataProvider: versionTreeProvider,
			showCollapseAll: true
		});
		console.log('Tree view provider created');

		// Register commands
		console.log('Registering commands...');
		const commands = [
			vscode.commands.registerCommand('llmcheckpoint.saveVersion', saveCurrentVersion),
			vscode.commands.registerCommand('llmcheckpoint.showVersionHistory', showVersionHistory),
			vscode.commands.registerCommand('llmcheckpoint.restoreVersion', restoreVersion),
			vscode.commands.registerCommand('llmcheckpoint.viewVersion', viewVersion),
			vscode.commands.registerCommand('llmcheckpoint.exportVersion', exportVersion),
			vscode.commands.registerCommand('llmcheckpoint.refreshVersions', () => {
				console.log('Refreshing versions view...');
				versionTreeProvider.refresh();
			})
		];
		console.log('Commands registered');

		// Create file system watcher
		console.log('Setting up file watcher...');
		const watcher = vscode.workspace.createFileSystemWatcher('**/*');
		
		// Handle file saves
		const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
			console.log(`File saved: ${document.uri.toString()}`);
			await handleFileChange(document.uri);
			versionTreeProvider.refresh();
		});

		// Handle file changes
		const fileWatcherDisposable = watcher.onDidChange(async (uri) => {
			console.log(`File changed: ${uri.toString()}`);
			const openTextDocuments = vscode.workspace.textDocuments;
			if (openTextDocuments.some(doc => doc.uri.toString() === uri.toString())) {
				await handleFileChange(uri);
				versionTreeProvider.refresh();
			}
		});

		// Register all disposables
		context.subscriptions.push(
			...commands,
			fileWatcherDisposable,
			onSaveDisposable,  // Add the save handler
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
		const relativePath = vscode.workspace.asRelativePath(uri);
		const document = await vscode.workspace.openTextDocument(uri);
		const content = document.getText();

		console.log('Creating/updating file record for:', relativePath);
		let file = fileVersionDB.getFile(relativePath);
		if (!file) {
			console.log('File not found in DB, creating new record');
			file = fileVersionDB.createFile(relativePath);
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
		
		// Show the diff
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

async function viewVersion(version: VersionRecord) {
	if (!version.file_id) {
		return;
	}

	// Get the current file content
	const file = fileVersionDB.getFile(version.file_id.toString());
	if (!file) {
		return;
	}

	try {
		// Create temporary files for diffing
		const currentDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(file.file_path));
		const currentContent = currentDoc.getText();

		// Create the diff using the built-in diff editor
		const versionUri = vscode.Uri.parse(`untitled:Version ${version.version_number}`);
		const versionDoc = await vscode.workspace.openTextDocument(versionUri);
		
		// Show both documents side by side
		await vscode.window.showTextDocument(versionDoc, { viewColumn: vscode.ViewColumn.One });
		await vscode.window.activeTextEditor?.edit(edit => {
			const fullRange = new vscode.Range(
				versionDoc.positionAt(0),
				versionDoc.positionAt(versionDoc.getText().length)
			);
			edit.replace(fullRange, version.content);
		});

		// Show the current version
		await vscode.window.showTextDocument(currentDoc, { viewColumn: vscode.ViewColumn.Two });

		// Execute the diff command
		await vscode.commands.executeCommand('vscode.diff',
			versionUri,
			currentDoc.uri,
			`Version ${version.version_number} (${new Date(version.timestamp).toLocaleString()}) ↔ Current`
		);
	} catch (error: any) {
		const errorMessage = error?.message || 'Unknown error occurred';
		vscode.window.showErrorMessage('Failed to show diff: ' + errorMessage);
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

// This method is called when your extension is deactivated
export function deactivate() {
	// Cleanup will be handled by VS Code's disposal of subscriptions
}
