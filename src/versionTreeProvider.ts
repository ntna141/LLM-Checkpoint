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
    private disposables: vscode.Disposable[] = [];
    private treeView?: vscode.TreeView<VersionTreeItem>;
    private fileItems: Map<string, VersionTreeItem> = new Map();
    private isRefreshing = false;
    private isReady: boolean = false;

    constructor(private fileVersionDB: FileVersionDB) {
        console.log('VersionTreeProvider constructed');
    }

    setTreeView(treeView: vscode.TreeView<VersionTreeItem>) {
        this.treeView = treeView;
        
        
        this.disposables.push(
            treeView.onDidExpandElement(e => {
                if (e.element.file) {
                    console.log(`File expanded: ${e.element.file.file_path}`);
                    this.expandedFiles.add(e.element.file.file_path);
                }
            }),
            treeView.onDidCollapseElement(e => {
                if (e.element.file) {
                    console.log(`File collapsed: ${e.element.file.file_path}`);
                    this.expandedFiles.delete(e.element.file.file_path);
                }
            }),
            treeView.onDidChangeVisibility(async () => {
                if (treeView.visible) {
                    console.log('Tree view became visible');
                    
                    const editor = vscode.window.activeTextEditor;
                    if (editor && !editor.document.uri.path.includes('.git/')) {
                        const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
                        await this.expandFile(relativePath, true);
                    }
                }
            })
        );

        
        console.log('Tree view is now ready');
        this.isReady = true;
        this._onDidChangeTreeData.fire();
    }

    private handleInitialEditor() {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.document.uri.path.includes('.git/')) {
            const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
            console.log(`Handling initial editor: ${relativePath}`);
            this.expandFile(relativePath, true);
        }
    }

    
    setupEditorTracking() {
        
        
        
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && !editor.document.uri.path.includes('.git/')) {
                    const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
                    console.log(`Active editor changed to: ${relativePath}`);
                    if (this.isReady) {
                        this.expandFile(relativePath, true);
                    } else {
                        console.log('Tree view not ready yet, skipping expansion');
                    }
                }
            })
        );
    }

    private async expandFile(filePath: string, forceExpand: boolean = false) {
        if (this.isRefreshing || !this.isReady) {
            console.log(`Skipping expand for ${filePath} - Tree view not ready or refreshing`);
            return;
        }

        console.log(`Attempting to expand file: ${filePath}`);
        const file = this.fileVersionDB.getFile(filePath);
        if (!file) {
            console.log(`No file found in database for path: ${filePath}`);
            return;
        }

        const versions = this.fileVersionDB.getFileVersions(file.id);
        console.log(`Found ${versions.length} versions for file: ${filePath}`);
        
        if (versions.length > 0) {
            const wasExpanded = this.expandedFiles.has(filePath);
            
            if (!wasExpanded || forceExpand || versions.length === 1) {
                try {
                    this.isRefreshing = true;
                    
                    
                    const treeItem = new VersionTreeItem(
                        filePath,
                        vscode.TreeItemCollapsibleState.Expanded,
                        file,
                        undefined,
                        versions
                    );
                    this.fileItems.set(filePath, treeItem);
                    this.expandedFiles.add(filePath);

                    
                    this._onDidChangeTreeData.fire();
                } finally {
                    this.isRefreshing = false;
                }
            }
        }
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.fileItems.clear();
        this.expandedFiles.clear();
    }

    refresh(filePath?: string): void {
        if (this.isRefreshing) {
            return;
        }

        try {
            this.isRefreshing = true;
            console.log('Refreshing tree view...', filePath ? `for file: ${filePath}` : 'full refresh');
            
            if (filePath) {
                
                this.expandFile(filePath, true);
            } else {
                this.fileItems.clear();
                this.expandedFiles.clear();
                this._onDidChangeTreeData.fire();
            }
        } finally {
            this.isRefreshing = false;
        }
    }

    getTreeItem(element: VersionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: VersionTreeItem): Promise<VersionTreeItem[]> {
        console.log('Getting children for tree view...', element ? `Parent: ${element.label}` : 'Root level');
        
        if (!element) {
            
            const allFiles = this.fileVersionDB.getAllFiles();
            const filesWithVersions = allFiles.filter(file => {
                const versions = this.fileVersionDB.getFileVersions(file.id);
                return versions.length > 0;
            });
            
            console.log(`Found ${filesWithVersions.length} files with versions (from ${allFiles.length} total)`);
            
            return filesWithVersions.map(file => {
                const relativePath = file.file_path;
                const versions = this.fileVersionDB.getFileVersions(file.id);
                
                let shouldExpand = this.expandedFiles.has(relativePath);
                if (!shouldExpand && this.isReady) {
                    console.log(`Auto-expanding file with versions: ${relativePath}`);
                    this.expandedFiles.add(relativePath);
                    shouldExpand = true;
                }
                
                const fileName = path.basename(relativePath);
                const dirPath = path.dirname(relativePath);
                
                const treeItem = new VersionTreeItem(
                    fileName,  
                    shouldExpand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    file,
                    undefined,
                    versions
                );
                
                
                treeItem.description = dirPath === '.' ? undefined : dirPath;
                
                this.fileItems.set(relativePath, treeItem);
                return treeItem;
            });
        } else if (element.file) {
            const versions = element.versions || this.fileVersionDB.getFileVersions(element.file.id);
            return versions.map((version, index) => {
                const timeAgo = versions.length - index;
                const promptText = timeAgo === 1 ? 'prompt' : 'prompts';
                return new VersionTreeItem(
                    `${timeAgo} ${promptText} ago (${new Date(version.timestamp).toLocaleTimeString()}, ${new Date(version.timestamp).toLocaleDateString()})`,
                    vscode.TreeItemCollapsibleState.None,
                    element.file,
                    version
                );
            });
        }
        return [];
    }

    async getParent(element: VersionTreeItem): Promise<VersionTreeItem | undefined> {
        if (element.version && element.file) {
            
            const parentItem = this.fileItems.get(element.file.file_path);
            if (parentItem) {
                return parentItem;
            }
            
            return new VersionTreeItem(
                element.file.file_path,
                vscode.TreeItemCollapsibleState.Expanded,
                element.file,
                undefined,
                this.fileVersionDB.getFileVersions(element.file.id)
            );
        }
        return undefined;
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

        
        let finalPath = filePath;
        const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        
        try {
            const stats = await vscode.workspace.fs.stat(fullPath);
            if ((stats.type & vscode.FileType.Directory) === vscode.FileType.Directory) {
                
                finalPath = path.join(filePath, 'history_context.txt');
            }
        } catch (error) {
            
            if (filePath.endsWith('/') || filePath.endsWith('\\')) {
                finalPath = path.join(filePath, 'history_context.txt');
            }
        }

        
        const finalFullPath = vscode.Uri.joinPath(workspaceFolder.uri, finalPath);
        console.log('Full export path:', finalFullPath.fsPath);
        
        
        const directory = path.dirname(finalFullPath.fsPath);
        await fs.promises.mkdir(directory, { recursive: true });
        
        const content = `Version from ${finalPath}\n\n${version.content}`;
        
        await fs.promises.writeFile(finalFullPath.fsPath, content, 'utf8');
        
        vscode.window.showInformationMessage(`Version exported successfully to ${finalPath}`);
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

        
        let finalPath = filePath;
        const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        
        try {
            const stats = await vscode.workspace.fs.stat(fullPath);
            if ((stats.type & vscode.FileType.Directory) === vscode.FileType.Directory) {
                
                finalPath = path.join(filePath, 'history_context.txt');
            }
        } catch (error) {
            
            if (filePath.endsWith('/') || filePath.endsWith('\\')) {
                finalPath = path.join(filePath, 'history_context.txt');
            }
        }

        
        const finalFullPath = vscode.Uri.joinPath(workspaceFolder.uri, finalPath);
        
        
        const directory = path.dirname(finalFullPath.fsPath);
        await fs.promises.mkdir(directory, { recursive: true });

        const newContent = `\n\nVersion from ${finalPath}\n\n${version.content}`;
        
        
        await fs.promises.appendFile(finalFullPath.fsPath, newContent, 'utf8');
        
        vscode.window.showInformationMessage(`Version appended to ${finalPath}`);
    } catch (error: any) {
        console.error('Error appending version:', error);
        throw error;
    }
} 