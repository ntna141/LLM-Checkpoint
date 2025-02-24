import * as vscode from 'vscode';
import { FileVersionDB } from './db';
import { FileRecord, VersionRecord } from './db/schema';
import * as fs from 'fs';
import * as path from 'path';
import { TreeItem, TreeItemCollapsibleState, ThemeIcon } from 'vscode';


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
        public readonly versions?: VersionRecord[]
    ) {
        super(label, collapsibleState);
        
        if (version) {
            this.contextValue = 'version';
            this.command = {
                command: 'llmcheckpoint.viewVersion',
                title: 'View Version',
                arguments: [version]
            };
            this.iconPath = new vscode.ThemeIcon('git-commit');
        }
    }
}

export class VersionTreeProvider implements vscode.TreeDataProvider<VersionTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<VersionTreeItem | undefined | null | void> = new vscode.EventEmitter<VersionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<VersionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private expandedFiles: Set<string> = new Set();

    constructor(private fileVersionDB: FileVersionDB) {
        console.log('VersionTreeProvider constructed');
    }

    refresh(filePath?: string): void {
        console.log('Refreshing tree view...', filePath ? `for file: ${filePath}` : 'full refresh');
        if (filePath) {
            this.expandedFiles.add(filePath);
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: VersionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: VersionTreeItem): Promise<VersionTreeItem[]> {
        console.log('Getting children for tree view...', element ? `Parent: ${element.label}` : 'Root level');
        
        if (!element) {
            const allFiles = this.fileVersionDB.getAllFiles();
            console.log(`Found ${allFiles.length} files in database`);
            
            return allFiles.map(file => {
                const relativePath = file.file_path;
                const versions = this.fileVersionDB.getFileVersions(file.id);
                console.log(`Processing file: ${relativePath}, found ${versions.length} versions`);
                
                const collapsibleState = this.expandedFiles.has(relativePath) 
                    ? TreeItemCollapsibleState.Expanded 
                    : TreeItemCollapsibleState.Collapsed;
                
                return new VersionTreeItem(
                    relativePath,
                    versions.length > 0 ? collapsibleState : TreeItemCollapsibleState.None,
                    file,
                    undefined,
                    versions
                );
            });
        } else if (element.file) {
            if (element.versions) {
                return element.versions.map(version => 
                    new VersionTreeItem(
                        `Version ${version.version_number} (${new Date(version.timestamp).toLocaleString()})`,
                        TreeItemCollapsibleState.None,
                        element.file,
                        version
                    )
                );
            }
            
            const versions = this.fileVersionDB.getFileVersions(element.file.id);
            return versions.map(version => 
                new VersionTreeItem(
                    `Version ${version.version_number} (${new Date(version.timestamp).toLocaleString()})`,
                    TreeItemCollapsibleState.None,
                    element.file,
                    version
                )
            );
        }
        return [];
    }
}

export async function exportVersionToFile(version: VersionRecord, filePath: string): Promise<void> {
    try {
        console.log('Exporting version to file:', {
            versionId: version.id,
            versionNumber: version.version_number,
            fileId: version.file_id,
            contentLength: version.content?.length || 0,
            targetPath: filePath
        });
        
        
        if (!version.content) {
            throw new Error('Version content is missing or undefined');
        }

        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        
        const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        console.log('Full export path:', fullPath.fsPath);
        
        
        const directory = path.dirname(fullPath.fsPath);
        await fs.promises.mkdir(directory, { recursive: true });
        
        
        const content = `Version from ${filePath}\n\n${version.content}`;
        
        
        await fs.promises.writeFile(fullPath.fsPath, content, 'utf8');
        
        
        vscode.window.showInformationMessage(`Version exported successfully to ${filePath}`);
        console.log('Version exported successfully');
    } catch (error: any) {
        console.error('Error details:', {
            error: error.message,
            stack: error.stack,
            version: version,
            filePath: filePath
        });
        throw error;
    }
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

export async function appendVersionToFile(version: VersionRecord, filePath: string): Promise<void> {
    try {
        if (!version.content) {
            throw new Error('Version content is missing or undefined');
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        const directory = path.dirname(fullPath.fsPath);
        await fs.promises.mkdir(directory, { recursive: true });

        const newContent = `\n\nVersion from ${filePath}\n\n${version.content}`;
        
        // Append to file, create if doesn't exist
        await fs.promises.appendFile(fullPath.fsPath, newContent, 'utf8');
        
        vscode.window.showInformationMessage(`Version appended to ${filePath}`);
    } catch (error: any) {
        console.error('Error appending version:', error);
        throw error;
    }
} 