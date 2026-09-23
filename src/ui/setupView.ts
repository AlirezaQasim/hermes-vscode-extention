import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';

export class SetupViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'hermes.setup';
    private view?: vscode.WebviewView;
    private context: vscode.ExtensionContext;
    private logger: Logger;
    private isConfigured = false;
    private configStatus = 'checking';

    constructor(context: vscode.ExtensionContext, logger: Logger) {
        this.context = context;
        this.logger = logger;
        this.checkConfiguration();
    }

    private async checkConfiguration(): Promise<void> {
        this.configStatus = 'checking';
        this.refresh();
        
        try {
            // Check if Hermes CLI is installed and configured
            const hermesHome = process.env.HERMES_HOME || 
                (process.platform === 'win32' 
                    ? `${process.env.USERPROFILE}\\.hermes`
                    : `${process.env.HOME}/.hermes`);
            
            const configFile = `${hermesHome}/config.yaml`;
            const envFile = `${hermesHome}/.env`;
            
            const fs = await import('fs');
            const configExists = fs.existsSync(configFile);
            const envExists = fs.existsSync(envFile);
            
            this.isConfigured = configExists && envExists;
            this.configStatus = this.isConfigured ? 'configured' : 'not_configured';
        } catch (error) {
            this.logger.error('Failed to check configuration', error);
            this.configStatus = 'error';
        }
        this.refresh();
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'runSetup':
                await this.runSetup();
                break;
            case 'checkConfig':
                await this.checkConfiguration();
                break;
            case 'openConfigFile':
                await this.openConfigFile();
                break;
            case 'openEnvFile':
                await this.openEnvFile();
                break;
        }
    }

    private async runSetup(): Promise<void> {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const terminal = vscode.window.createTerminal({
            name: 'Hermes Setup',
            cwd
        });
        terminal.show();
        terminal.sendText('hermes setup');
        
        // Wait a bit and re-check
        setTimeout(() => this.checkConfiguration(), 5000);
    }

    private async openConfigFile(): Promise<void> {
        const hermesHome = process.env.HERMES_HOME || 
            (process.platform === 'win32' 
                ? `${process.env.USERPROFILE}\\.hermes`
                : `${process.env.HOME}/.hermes`);
        const configFile = `${hermesHome}/config.yaml`;
        
        try {
            const doc = await vscode.workspace.openTextDocument(configFile);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open config: ${error}`);
        }
    }

    private async openEnvFile(): Promise<void> {
        const hermesHome = process.env.HERMES_HOME || 
            (process.platform === 'win32' 
                ? `${process.env.USERPROFILE}\\.hermes`
                : `${process.env.HOME}/.hermes`);
        const envFile = `${hermesHome}/.env`;
        
        try {
            const doc = await vscode.workspace.openTextDocument(envFile);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open .env: ${error}`);
        }
    }

    refresh(): void {
        if (this.view) {
            this.view.webview.postMessage({
                type: 'update',
                isConfigured: this.isConfigured,
                configStatus: this.configStatus
            });
        }
    }

    private getHtml(): string {
        const scriptUri = this.view?.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'setupView.js')
        ) || '';

        const styleUri = this.view?.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'setupView.css')
        ) || '';

        const nonce = this.getNonce();

        let statusHtml = '';
        if (this.configStatus === 'checking') {
            statusHtml = '<div class="status checking">🔄 Checking configuration...</div>';
        } else if (this.configStatus === 'configured') {
            statusHtml = '<div class="status configured">✅ Hermes is configured</div>';
        } else if (this.configStatus === 'not_configured') {
            statusHtml = '<div class="status not-configured">⚠️ Hermes not configured</div>';
        } else {
            statusHtml = '<div class="status error">❌ Error checking configuration</div>';
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view?.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>Hermes Setup</title>
</head>
<body>
    <div class="container">
        <h1>Hermes Agent Setup</h1>
        <div id="status">${statusHtml}</div>
        
        <div class="section">
            <h2>Quick Actions</h2>
            <div class="buttons">
                <button id="btn-run-setup" class="primary">🔧 Run Hermes Setup</button>
                <button id="btn-check-config">🔄 Re-check Configuration</button>
            </div>
        </div>

        <div class="section">
            <h2>Configuration Files</h2>
            <div class="buttons">
                <button id="btn-open-config">📄 Open config.yaml</button>
                <button id="btn-open-env">🔐 Open .env (API Keys)</button>
            </div>
        </div>

        <div class="section">
            <h2>Status</h2>
            <div class="info">
                <p><strong>Hermes Home:</strong> <code id="hermes-home"></code></p>
                <p><strong>VS Code Workspace:</strong> <code id="workspace"></code></p>
            </div>
        </div>

        <div class="section">
            <h2>Help</h2>
            <ul>
                <li>Run <code>hermes setup</code> to configure providers and models</li>
                <li>API keys are stored in <code>~/.hermes/.env</code></li>
                <li>Settings are in <code>~/.hermes/config.yaml</code></li>
                <li>Sessions persist in <code>~/.hermes/state.db</code></li>
            </ul>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}