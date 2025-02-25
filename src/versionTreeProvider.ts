import * as vscode from 'vscode';
import { FileVersionDB } from './db';
import { FileRecord, VersionRecord } from './db/schema';
import * as fs from 'fs';
import * as path from 'path';
import { SettingsManager } from './settings';


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
    public backgroundColor?: vscode.ThemeColor;
    
    constructor(
        public readonly label: string | vscode.TreeItemLabel,
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
    private activeFilePath: string | undefined;

    constructor(
        private fileVersionDB: FileVersionDB,
        private settingsManager: SettingsManager
    ) {
        this.activeFilePath = undefined;
    }

    setTreeView(treeView: vscode.TreeView<VersionTreeItem>) {
        this.treeView = treeView;
        
        
        this.disposables.push(
            treeView.onDidExpandElement(e => {
                if (e.element.file) {
                    this.expandedFiles.add(e.element.file.file_path);
                }
            }),
            treeView.onDidCollapseElement(e => {
                if (e.element.file) {
                    this.expandedFiles.delete(e.element.file.file_path);
                }
            }),
            treeView.onDidChangeVisibility(async () => {
                if (treeView.visible) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && !editor.document.uri.path.includes('.git/')) {
                        const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
                        await this.expandFile(relativePath, true);
                    }
                }
            })
        );
        
        this.isReady = true;
        this._onDidChangeTreeData.fire();
    }

    private handleInitialEditor() {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.document.uri.path.includes('.git/')) {
            const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
            this.expandFile(relativePath, true);
        }
    }

    
    setupEditorTracking() {
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && !editor.document.uri.path.includes('.git/')) {
                    const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
                    this.activeFilePath = relativePath;
                    if (this.isReady) {
                        this.expandFile(relativePath, true);
                    }
                }
            })
        );
    }

    private async expandFile(filePath: string, forceExpand: boolean = false) {
        if (this.isRefreshing || !this.isReady) {

            return;
        }

        const file = this.fileVersionDB.getFile(filePath);
        if (!file) {
            return;
        }

        const versions = this.fileVersionDB.getFileVersions(file.id);
        
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
        if (!element) {
            const allFiles = this.fileVersionDB.getAllFiles();
            const filesWithVersions = allFiles.filter(file => {
                const versions = this.fileVersionDB.getFileVersions(file.id);
                return versions.length > 0;
            });
            
            return filesWithVersions.map(file => {
                const relativePath = file.file_path;
                const versions = this.fileVersionDB.getFileVersions(file.id);
                
                let shouldExpand = this.expandedFiles.has(relativePath);
                if (!shouldExpand && this.isReady) {
                    this.expandedFiles.add(relativePath);
                    shouldExpand = true;
                }
                
                const fileName = path.basename(relativePath);
                const dirPath = path.dirname(relativePath);
                
                const isActive = relativePath === this.activeFilePath;
                
                const treeItem = new VersionTreeItem(
                    isActive ? {
                        label: fileName,
                        highlights: [[0, fileName.length]]
                    } : fileName,
                    shouldExpand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    file,
                    undefined,
                    versions
                );
                
                if (isActive) {
                    treeItem.description = dirPath === '.' ? undefined : dirPath;
                } else {
                    treeItem.description = dirPath === '.' ? undefined : dirPath;
                }
                
                this.fileItems.set(relativePath, treeItem);
                return treeItem;
            });
        } else if (element.file) {
            const versions = element.versions || this.fileVersionDB.getFileVersions(element.file.id);
            const showTimestamps = await this.settingsManager.getShowTimestamps();
            
            return versions.map((version, index) => {
                const timeAgo = index + 1;
                const promptText = timeAgo === 1 ? 'prompt' : 'prompts';
                const label = `${timeAgo} ${promptText} ago`;

                const treeItem = new VersionTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.None,
                    element.file,
                    version
                );
                
                if (showTimestamps) {
                    const date = new Date(version.timestamp);
                    treeItem.description = `${date.toLocaleString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                    })} ${date.toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric'
                    })}`;
                }
                
                treeItem.iconPath = new vscode.ThemeIcon('git-commit');
                return treeItem;
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

let settingsManager: SettingsManager;
let fileVersionDB: FileVersionDB;

export function initializeProviders(db: FileVersionDB, manager: SettingsManager) {
    fileVersionDB = db;
    settingsManager = manager;
}

async function getFileForVersion(version: VersionRecord): Promise<FileRecord> {
    if (!version.content) {
        throw new Error('Version content is missing or undefined');
    }

    const file = await fileVersionDB.getFileById(version.file_id);
    if (!file) {
        throw new Error('Could not find the file record');
    }

    return file;
}

async function ensureExportPath(exportPath: string): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    let finalPath = exportPath;
    const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, exportPath);
    
    try {
        const stats = await vscode.workspace.fs.stat(fullPath);
        if ((stats.type & vscode.FileType.Directory) === vscode.FileType.Directory) {
            finalPath = path.join(exportPath, 'history_context.txt');
        }
    } catch (error) {
        if (exportPath.endsWith('/') || exportPath.endsWith('\\')) {
            finalPath = path.join(exportPath, 'history_context.txt');
        }
    }

    const finalFullPath = vscode.Uri.joinPath(workspaceFolder.uri, finalPath);
    const directory = path.dirname(finalFullPath.fsPath);
    await fs.promises.mkdir(directory, { recursive: true });

    return finalPath;
}

async function writeVersionToFile(version: VersionRecord, file: FileRecord, finalPath: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    const finalFullPath = vscode.Uri.joinPath(workspaceFolder.uri, finalPath);
    const content = `Version from ${file.file_path}\n\n${version.content}`;
    await fs.promises.writeFile(finalFullPath.fsPath, content, 'utf8');
}

async function appendVersionToExistingFile(version: VersionRecord, file: FileRecord, finalPath: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    const finalFullPath = vscode.Uri.joinPath(workspaceFolder.uri, finalPath);
    const newContent = `\n\nVersion from ${file.file_path}\n\n${version.content}`;
    await fs.promises.appendFile(finalFullPath.fsPath, newContent, 'utf8');
}

function handleExportError(error: any) {
    console.error('Error details:', {
        error: error.message,
        stack: error.stack
    });
    throw error;
}

export async function exportVersionToFile(version: VersionRecord, exportPath: string): Promise<void> {
    try {
        const file = await getFileForVersion(version);
        const finalPath = await ensureExportPath(exportPath);
        await writeVersionToFile(version, file, finalPath);
        await settingsManager.showConditionalInfoMessage(`Version exported successfully to ${finalPath}`);
    } catch (error) {
        handleExportError(error);
    }
}

export async function appendVersionToFile(version: VersionRecord, exportPath: string): Promise<void> {
    try {
        const file = await getFileForVersion(version);
        const finalPath = await ensureExportPath(exportPath);
        await appendVersionToExistingFile(version, file, finalPath);
        await settingsManager.showConditionalInfoMessage(`Version appended to ${finalPath}`);
    } catch (error) {
        handleExportError(error);
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