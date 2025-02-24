import * as vscode from 'vscode';
import * as path from 'path';

export class SettingsManager {
    private static readonly HISTORY_PATH_KEY = 'historyContextPath';
    private static readonly SAVE_ALL_CHANGES_KEY = 'saveAllChanges';
    private static readonly SHOW_INFO_MESSAGES_KEY = 'showInfoMessages';
    private static readonly AUTO_CLEANUP_AFTER_COMMIT_KEY = 'autoCleanupAfterCommit';
    private static readonly SHOW_TIMESTAMPS_KEY = 'showTimestamps';
    private panel: vscode.WebviewPanel | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    async getHistoryPath(): Promise<string> {
        const workspaceState = this.context.workspaceState;
        return workspaceState.get<string>(SettingsManager.HISTORY_PATH_KEY, 'history_context.txt');
    }

    async getSaveAllChanges(): Promise<boolean> {
        const workspaceState = this.context.workspaceState;
        const value = workspaceState.get<boolean>(SettingsManager.SAVE_ALL_CHANGES_KEY, false);
        return value;
    }

    async getShowInfoMessages(): Promise<boolean> {
        const workspaceState = this.context.workspaceState;
        const value = workspaceState.get<boolean>(SettingsManager.SHOW_INFO_MESSAGES_KEY, true);
        return value;
    }

    async getAutoCleanupAfterCommit(): Promise<boolean> {
        const workspaceState = this.context.workspaceState;
        return workspaceState.get<boolean>(SettingsManager.AUTO_CLEANUP_AFTER_COMMIT_KEY, true);
    }

    async getShowTimestamps(): Promise<boolean> {
        const workspaceState = this.context.workspaceState;
        return workspaceState.get<boolean>(SettingsManager.SHOW_TIMESTAMPS_KEY, true);
    }

    async setSaveAllChanges(value: boolean): Promise<void> {
        await this.context.workspaceState.update(SettingsManager.SAVE_ALL_CHANGES_KEY, value);
        if (this.panel) {
            this.panel.webview.html = await this.getWebviewContent();
        }
    }

    async setShowInfoMessages(value: boolean): Promise<void> {
        await this.context.workspaceState.update(SettingsManager.SHOW_INFO_MESSAGES_KEY, value);
        if (this.panel) {
            this.panel.webview.html = await this.getWebviewContent();
        }
    }

    async setAutoCleanupAfterCommit(value: boolean): Promise<void> {
        await this.context.workspaceState.update(SettingsManager.AUTO_CLEANUP_AFTER_COMMIT_KEY, value);
        if (this.panel) {
            this.panel.webview.html = await this.getWebviewContent();
        }
    }

    async setShowTimestamps(value: boolean): Promise<void> {
        await this.context.workspaceState.update(SettingsManager.SHOW_TIMESTAMPS_KEY, value);
        if (this.panel) {
            this.panel.webview.html = await this.getWebviewContent();
        }
    }

    async setHistoryPath(filePath: string): Promise<void> {
        await this.context.workspaceState.update(SettingsManager.HISTORY_PATH_KEY, filePath);
        if (this.panel) {
            this.panel.webview.html = await this.getWebviewContent();
        }
    }

    async showConditionalInfoMessage(message: string): Promise<void> {
        const showInfoMessages = await this.getShowInfoMessages();
        if (showInfoMessages) {
            await vscode.window.showInformationMessage(message);
        }
    }

    private async getWebviewContent(): Promise<string> {
        const currentPath = await this.getHistoryPath();
        const saveAllChanges = await this.getSaveAllChanges();
        const showInfoMessages = await this.getShowInfoMessages();
        const autoCleanupAfterCommit = await this.getAutoCleanupAfterCommit();
        const showTimestamps = await this.getShowTimestamps();
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <style>
                body {
                    padding: 20px;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                }
                .container {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    max-width: 600px;
                }
                .path-container {
                    display: flex;
                    gap: 8px;
                    align-items: flex-start;
                }
                .path-input {
                    flex-grow: 1;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 4px 8px;
                    border-radius: 2px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                }
                .path-input:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    border-color: var(--vscode-focusBorder);
                }
                .button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 4px 8px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                    white-space: nowrap;
                    align-self: flex-start;
                }
                .button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .button-container {
                    display: flex;
                    gap: 8px;
                }
                .title {
                    font-size: 13px;
                    font-weight: 600;
                    margin-bottom: 4px;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    font-size: 12px;
                    margin-top: 4px;
                    display: none;
                }
                .checkbox-container {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 16px;
                }
                .checkbox-container input[type="checkbox"] {
                    margin: 0;
                }
                .checkbox-label {
                    font-size: 13px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div>
                    <div class="title">Export Location</div>
                    <div class="path-container">
                        <input type="text" class="path-input" id="pathInput" value="${currentPath}" 
                               placeholder="Enter path relative to workspace root">
                        <div class="button-container">
                            <button class="button" onclick="handleSavePath()">Save</button>
                            <button class="button" onclick="handleChoosePath()">Choose Location</button>
                        </div>
                    </div>
                    <div class="error" id="pathError"></div>
                </div>
                <div class="checkbox-container">
                    <input type="checkbox" id="saveAllChanges" ${saveAllChanges ? 'checked' : ''}>
                    <label for="saveAllChanges" class="checkbox-label">Save all changes (uncheck to save only multiline changes)</label>
                </div>
                <div class="checkbox-container">
                    <input type="checkbox" id="showInfoMessages" ${showInfoMessages ? 'checked' : ''}>
                    <label for="showInfoMessages" class="checkbox-label">Show information messages</label>
                </div>
                <div class="checkbox-container">
                    <input type="checkbox" id="autoCleanupAfterCommit" ${autoCleanupAfterCommit ? 'checked' : ''}>
                    <label for="autoCleanupAfterCommit" class="checkbox-label">Auto-cleanup versions after git commit (keeps latest version with commit message)</label>
                </div>
                <div class="checkbox-container">
                    <input type="checkbox" id="showTimestamps" ${showTimestamps ? 'checked' : ''}>
                    <label for="showTimestamps" class="checkbox-label">Show timestamps next to version entries</label>
                </div>
                <div class="button-container" style="margin-top: 24px;">
                    <button class="button" onclick="handleQuickClean()">Quick Clean</button>
                    <button class="button" onclick="handleClearAll()">Clear All Versions</button>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                function handleChoosePath() {
                    vscode.postMessage({ command: 'changeLocation' });
                }

                function handleSavePath() {
                    const input = document.getElementById('pathInput');
                    vscode.postMessage({ 
                        command: 'updatePath',
                        path: input.value
                    });
                }

                function handleQuickClean() {
                    vscode.postMessage({ command: 'quickClean' });
                }

                function handleClearAll() {
                    vscode.postMessage({ command: 'clearAll' });
                }

                document.getElementById('saveAllChanges').addEventListener('change', (event) => {
                    vscode.postMessage({
                        command: 'updateSaveAllChanges',
                        value: event.target.checked
                    });
                });

                document.getElementById('showInfoMessages').addEventListener('change', (event) => {
                    vscode.postMessage({
                        command: 'updateShowInfoMessages',
                        value: event.target.checked
                    });
                });

                document.getElementById('autoCleanupAfterCommit').addEventListener('change', (event) => {
                    vscode.postMessage({
                        command: 'updateAutoCleanupAfterCommit',
                        value: event.target.checked
                    });
                });

                document.getElementById('showTimestamps').addEventListener('change', (event) => {
                    vscode.postMessage({
                        command: 'updateShowTimestamps',
                        value: event.target.checked
                    });
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'error') {
                        const errorDiv = document.getElementById('pathError');
                        errorDiv.textContent = message.message;
                        errorDiv.style.display = 'block';
                        setTimeout(() => {
                            errorDiv.style.display = 'none';
                        }, 5000);
                    }
                });
            </script>
        </body>
        </html>`;
    }

    async showSettingsUI(): Promise<void> {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'llmCheckpointSettings',
            'LLM Checkpoint Settings',
            vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );

        this.panel.webview.html = await this.getWebviewContent();

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'changeLocation':
                        await this.showLocationPicker();
                        break;
                    case 'updatePath':
                        await this.validateAndUpdatePath(message.path);
                        break;
                    case 'updateSaveAllChanges':
                        await this.setSaveAllChanges(message.value);
                        break;
                    case 'updateShowInfoMessages':
                        await this.setShowInfoMessages(message.value);
                        break;
                    case 'updateAutoCleanupAfterCommit':
                        await this.setAutoCleanupAfterCommit(message.value);
                        break;
                    case 'updateShowTimestamps':
                        await this.setShowTimestamps(message.value);
                        break;
                    case 'quickClean':
                        await vscode.commands.executeCommand('llmcheckpoint.quickClean');
                        break;
                    case 'clearAll':
                        await vscode.commands.executeCommand('llmcheckpoint.clearAll');
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        this.panel.onDidDispose(
            () => {
                this.panel = undefined;
            },
            null,
            this.context.subscriptions
        );
    }

    private async showLocationPicker(): Promise<void> {
        const currentPath = await this.getHistoryPath();
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Export Location',
            defaultUri: vscode.Uri.joinPath(workspaceFolder.uri, path.dirname(currentPath))
        };

        const folderUri = await vscode.window.showOpenDialog(options);
        if (!folderUri || folderUri.length === 0) {
            return;
        }

        const fileName = await vscode.window.showInputBox({
            prompt: 'Enter the file name for version history',
            value: path.basename(currentPath),
            validateInput: (value) => {
                if (!value) {
                    return 'File name cannot be empty';
                }
                return null;
            }
        });

        if (!fileName) {
            return;
        }

        const relativePath = vscode.workspace.asRelativePath(
            vscode.Uri.joinPath(folderUri[0], fileName)
        );
        
        await this.setHistoryPath(relativePath);
        vscode.window.showInformationMessage(`Export location set to: ${relativePath}`);
    }

    private async validateAndUpdatePath(inputPath: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder found');
            }

            
            if (!inputPath.trim()) {
                await this.setHistoryPath('history_context.txt');
                return;
            }

            
            let cleanPath = inputPath.trim();
            if (path.isAbsolute(cleanPath)) {
                cleanPath = path.relative(workspaceFolder.uri.fsPath, cleanPath);
            }

            
            const fullUri = vscode.Uri.joinPath(workspaceFolder.uri, cleanPath);
            
            try {
                
                const stats = await vscode.workspace.fs.stat(fullUri);
                if ((stats.type & vscode.FileType.Directory) === vscode.FileType.Directory) {
                    
                    cleanPath = path.join(cleanPath, 'history_context.txt');
                    this.panel?.webview.postMessage({ 
                        type: 'error',
                        message: 'Path is a directory. Appending default filename: history_context.txt'
                    });
                }
            } catch (error) {
                
                const parentDir = path.dirname(fullUri.fsPath);
                try {
                    await vscode.workspace.fs.stat(vscode.Uri.file(parentDir));
                } catch (error) {
                    
                    cleanPath = path.join('', path.basename(cleanPath));
                    if (cleanPath.endsWith('/') || cleanPath.endsWith('\\')) {
                        cleanPath = path.join(cleanPath, 'history_context.txt');
                    }
                    this.panel?.webview.postMessage({ 
                        type: 'error',
                        message: 'Directory not found. Path will be created in workspace root.'
                    });
                }
            }

            
            if (cleanPath.endsWith('/') || cleanPath.endsWith('\\') || !path.extname(cleanPath)) {
                cleanPath = path.join(cleanPath, 'history_context.txt');
            }

            await this.setHistoryPath(cleanPath);
            vscode.window.showInformationMessage(`Export location set to: ${cleanPath}`);
        } catch (error) {
            this.panel?.webview.postMessage({ 
                type: 'error',
                message: 'Invalid path. Please enter a valid relative path.'
            });
            
            const defaultPath = path.join('', path.basename(inputPath) || 'history_context.txt');
            await this.setHistoryPath(defaultPath);
        }
    }
} 