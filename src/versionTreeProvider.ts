import * as vscode from 'vscode';
import { FileVersionDB } from './db';
import { FileRecord, VersionRecord } from './db/schema';
import * as fs from 'fs';
import * as path from 'path';


const VERSION_SCHEME = 'llm-version';


class VersionContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    
    constructor(private versions: Map<string, string>) {}

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.versions.get(uri.path) || '';
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    
    addVersion(versionId: string, content: string) {
        this.versions.set(versionId, content);
    }
}


const versionContent = new Map<string, string>();
const versionProvider = new VersionContentProvider(versionContent);
let contentProviderRegistration: vscode.Disposable;

export function registerVersionProvider(context: vscode.ExtensionContext) {
    contentProviderRegistration = vscode.workspace.registerTextDocumentContentProvider(
        VERSION_SCHEME,
        versionProvider
    );
    context.subscriptions.push(contentProviderRegistration);
}

export class VersionTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly file?: FileRecord,
        public readonly version?: VersionRecord,
        command?: vscode.Command
    ) {
        super(label, collapsibleState);
        if (command) {
            this.command = command;
        }
    }
}

export class VersionTreeProvider implements vscode.TreeDataProvider<VersionTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<VersionTreeItem | undefined | null | void> = new vscode.EventEmitter<VersionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<VersionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private fileVersionDB: FileVersionDB) {
        console.log('VersionTreeProvider constructed');
    }

    refresh(): void {
        console.log('Refreshing tree view...');
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: VersionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: VersionTreeItem): Promise<VersionTreeItem[]> {
        console.log('Getting children for tree view...', element ? `Parent: ${element.label}` : 'Root level');
        
        if (!element) {
            
            const openFiles = vscode.workspace.textDocuments
                .filter(doc => !doc.isUntitled && doc.uri.scheme === 'file');
            
            console.log(`Found ${openFiles.length} open files`);
            
            return openFiles.map(doc => {
                const relativePath = vscode.workspace.asRelativePath(doc.uri);
                const file = this.fileVersionDB.getFile(relativePath);
                console.log(`Processing file: ${relativePath}, DB record:`, file);
                return new VersionTreeItem(
                    relativePath,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    file
                );
            });
        } else if (element.file) {
            
            const versions = this.fileVersionDB.getFileVersions(element.file.id);
            console.log(`Found ${versions.length} versions for file ${element.file.file_path}`);
            
            return versions.map(version => {
                const label = `Version ${version.version_number}`;
                const description = new Date(version.timestamp).toLocaleString();
                const treeItem = new VersionTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.None,
                    element.file,
                    version,
                    {
                        command: 'llmcheckpoint.viewVersion',
                        title: 'View Version',
                        arguments: [version]
                    }
                );
                treeItem.description = description;
                treeItem.contextValue = 'version';
                console.log('Creating tree item with version:', version);
                return treeItem;
            });
        }
        return [];
    }
}

export async function exportVersionToFile(version: VersionRecord, filePath: string): Promise<void> {
    console.log('Exporting version to file:', version);
    const historyContext = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'history_context.txt');
    const content = `Version ${version.version_number} - ${new Date(version.timestamp).toLocaleString()}\n\n${version.content}`;
    await fs.promises.writeFile(historyContext, content, 'utf8');
    console.log('Version exported successfully');
}

export async function viewVersion(version: VersionRecord, db: FileVersionDB): Promise<void> {
    try {
        
        const file = db.getFileById(version.file_id);
        if (!file) {
            vscode.window.showErrorMessage('Could not find the file record');
            return;
        }

        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        
        const currentUri = vscode.Uri.joinPath(workspaceFolder.uri, file.file_path);
        
        
        try {
            await vscode.workspace.fs.stat(currentUri);
        } catch (error) {
            vscode.window.showErrorMessage(`File not found: ${file.file_path}`);
            return;
        }
        
        
        const ext = path.extname(file.file_path);
        
        
        const versionId = `${file.file_path}-v${version.version_number}${ext}`;
        versionProvider.addVersion(versionId, version.content);
        
        
        const versionUri = vscode.Uri.parse(`${VERSION_SCHEME}:${versionId}`);
        
        
        await vscode.commands.executeCommand('vscode.diff',
            currentUri,
            versionUri,
            `Current ↔ Version ${version.version_number} (${new Date(version.timestamp).toLocaleString()})`,
            {
                preview: true,
                viewColumn: vscode.ViewColumn.Active
            }
        );

    } catch (error: any) {
        console.error('Error showing version:', error);
        vscode.window.showErrorMessage('Failed to show version: ' + error.message);
    }
} 