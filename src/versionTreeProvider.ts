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
        
        // Listen for expansion events to track state
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
                    // Only handle the current file when the user explicitly opens the view
                    const editor = vscode.window.activeTextEditor;
                    if (editor && !editor.document.uri.path.includes('.git/')) {
                        const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
                        await this.expandFile(relativePath, true);
                    }
                }
            })
        );

        // Mark as ready immediately and trigger initial population
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

    // Track active editor changes
    setupEditorTracking() {
        // Don't handle initial editor here anymore, it's done in setTreeView
        
        // Listen for active editor changes
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
            // Always expand if this is the first version (versions.length === 1) or if forced
            if (!wasExpanded || forceExpand || versions.length === 1) {
                try {
                    this.isRefreshing = true;
                    
                    // Create the tree item first
                    const treeItem = new VersionTreeItem(
                        filePath,
                        vscode.TreeItemCollapsibleState.Expanded,
                        file,
                        undefined,
                        versions
                    );
                    this.fileItems.set(filePath, treeItem);
                    this.expandedFiles.add(filePath);

                    // Just refresh the tree data without revealing
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
                // Force expand when refreshing a specific file
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
            // Root level - return all files
            const allFiles = this.fileVersionDB.getAllFiles();
            console.log(`Found ${allFiles.length} files in database`);
            
            return allFiles.map(file => {
                const relativePath = file.file_path;
                const versions = this.fileVersionDB.getFileVersions(file.id);
                
                // Auto-expand files with versions on first load
                let shouldExpand = this.expandedFiles.has(relativePath);
                if (!shouldExpand && this.isReady && versions.length > 0) {
                    console.log(`Auto-expanding file with versions: ${relativePath}`);
                    this.expandedFiles.add(relativePath);
                    shouldExpand = true;
                }
                
                console.log(`Processing file: ${relativePath}, found ${versions.length} versions, expanded: ${shouldExpand}`);
                
                const treeItem = new VersionTreeItem(
                    relativePath,
                    versions.length > 0 
                        ? (shouldExpand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                        : vscode.TreeItemCollapsibleState.None,
                    file,
                    undefined,
                    versions
                );
                
                // Store the file item for reveal operations
                this.fileItems.set(relativePath, treeItem);
                return treeItem;
            });
        } else if (element.file) {
            // File level - return versions
            const versions = element.versions || this.fileVersionDB.getFileVersions(element.file.id);
            return versions.map(version => 
                new VersionTreeItem(
                    `Version ${version.version_number} (${new Date(version.timestamp).toLocaleString()})`,
                    vscode.TreeItemCollapsibleState.None,
                    element.file,
                    version
                )
            );
        }
        return [];
    }

    async getParent(element: VersionTreeItem): Promise<VersionTreeItem | undefined> {
        if (element.version && element.file) {
            // For version items, return the parent file item
            const parentItem = this.fileItems.get(element.file.file_path);
            if (parentItem) {
                return parentItem;
            }
            // If parent not found in cache, create it
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

        // Ensure the path has a filename if it's a directory
        let finalPath = filePath;
        const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        
        try {
            const stats = await vscode.workspace.fs.stat(fullPath);
            if ((stats.type & vscode.FileType.Directory) === vscode.FileType.Directory) {
                // If it's a directory, append the default filename
                finalPath = path.join(filePath, 'history_context.txt');
            }
        } catch (error) {
            // Path doesn't exist, check if it ends with a directory separator
            if (filePath.endsWith('/') || filePath.endsWith('\\')) {
                finalPath = path.join(filePath, 'history_context.txt');
            }
        }

        // Get the final full path with any adjustments
        const finalFullPath = vscode.Uri.joinPath(workspaceFolder.uri, finalPath);
        console.log('Full export path:', finalFullPath.fsPath);
        
        // Create directory if it doesn't exist
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

        // Ensure the path has a filename if it's a directory
        let finalPath = filePath;
        const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        
        try {
            const stats = await vscode.workspace.fs.stat(fullPath);
            if ((stats.type & vscode.FileType.Directory) === vscode.FileType.Directory) {
                // If it's a directory, append the default filename
                finalPath = path.join(filePath, 'history_context.txt');
            }
        } catch (error) {
            // Path doesn't exist, check if it ends with a directory separator
            if (filePath.endsWith('/') || filePath.endsWith('\\')) {
                finalPath = path.join(filePath, 'history_context.txt');
            }
        }

        // Get the final full path with any adjustments
        const finalFullPath = vscode.Uri.joinPath(workspaceFolder.uri, finalPath);
        
        // Create directory if it doesn't exist
        const directory = path.dirname(finalFullPath.fsPath);
        await fs.promises.mkdir(directory, { recursive: true });

        const newContent = `\n\nVersion from ${finalPath}\n\n${version.content}`;
        
        // Append to file, create if doesn't exist
        await fs.promises.appendFile(finalFullPath.fsPath, newContent, 'utf8');
        
        vscode.window.showInformationMessage(`Version appended to ${finalPath}`);
    } catch (error: any) {
        console.error('Error appending version:', error);
        throw error;
    }
} 