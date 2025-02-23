import * as vscode from 'vscode';
import { FileVersionDB } from './db';
import { FileRecord, VersionRecord } from './db/schema';
import * as fs from 'fs';
import * as path from 'path';

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
            // Root level - show open files
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
            // File level - show versions
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