import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { getHermesHome } from '../utils/hermesPaths';
import * as fs from 'fs';
import * as path from 'path';

export class SetupViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'hermes.setup';
    private view?: vscode.WebviewView;
    private context: vscode.ExtensionContext;
    private logger: Logger;
    private isConfigured = false;
    private configStatus = 'checking';
    private hermesHome = '';

    constructor(context: vscode.ExtensionContext, logger: Logger) {
        this.context = context;
        this.logger = logger;
        this.hermesHome = getHermesHome();
        this.checkConfiguration();
    }

    private async checkConfiguration(): Promise<void> {
        this.configStatus = 'checking';
        this.hermesHome = getHermesHome();
        this.refresh();
        
        try {
            const configFile = path.join(this.hermesHome, 'config.yaml');
            const envFile = path.join(this.hermesHome, '.env');
            
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
            case 'connect':
                await vscode.commands.executeCommand('hermes.connect');
                break;
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
        
        setTimeout(() => this.checkConfiguration(), 5000);
    }

    private async openConfigFile(): Promise<void> {
        const configFile = path.join(this.hermesHome, 'config.yaml');
        try {
            if (!fs.existsSync(configFile)) {
                vscode.window.showInformationMessage(`Creating config.yaml at ${configFile}`);
                fs.writeFileSync(configFile, '# Hermes configuration\n', 'utf8');
            }
            const doc = await vscode.workspace.openTextDocument(configFile);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open config: ${error}`);
        }
    }

    private async openEnvFile(): Promise<void> {
        const envFile = path.join(this.hermesHome, '.env');
        try {
            if (!fs.existsSync(envFile)) {
                vscode.window.showInformationMessage(`Creating .env at ${envFile}`);
                fs.writeFileSync(envFile, '# Hermes API keys\n', 'utf8');
            }
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
                configStatus: this.configStatus,
                hermesHome: this.hermesHome
            });
        }
    }

    private getHtml(): string {
        const nonce = this.getNonce();

        const css = `
.container{padding:16px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground)}
h1{font-size:1.3em;margin-bottom:14px;color:var(--vscode-foreground);display:flex;align-items:center;gap:8px}
h2{font-size:1.05em;margin:18px 0 10px;color:var(--vscode-foreground);border-bottom:1px solid var(--vscode-panel-border);padding-bottom:4px}
.section{margin-bottom:16px}
.buttons{display:flex;flex-direction:column;gap:8px}
button{padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;transition:background-color 0.2s;text-align:left;display:flex;align-items:center;gap:8px}
button.primary{background-color:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button.primary:hover{background-color:var(--vscode-button-hoverBackground)}
button:not(.primary){background-color:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button:not(.primary):hover{background-color:var(--vscode-button-secondaryHoverBackground)}
button:disabled{opacity:0.5;cursor:not-allowed}
.status{padding:10px 12px;border-radius:6px;margin-bottom:14px;font-weight:500;font-size:12px}
.status.checking{background-color:var(--vscode-editorInfo-background);color:var(--vscode-editorInfo-foreground)}
.status.configured{background-color:rgba(46,160,67,0.15);color:#3fb950;border:1px solid rgba(46,160,67,0.4)}
.status.not-configured{background-color:rgba(210,153,34,0.15);color:#d29922;border:1px solid rgba(210,153,34,0.4)}
.status.error{background-color:rgba(248,81,73,0.15);color:#f85149;border:1px solid rgba(248,81,73,0.4)}
.info{font-size:11px;line-height:1.6;background:var(--vscode-editor-inactiveSelectionBackground);padding:10px;border-radius:6px;word-break:break-all}
.info code{background-color:var(--vscode-textCodeBlock-background);padding:2px 5px;border-radius:3px;font-family:var(--vscode-editor-font-family);font-size:0.9em}
ul{margin:8px 0;padding-left:18px}
li{margin:4px 0;line-height:1.4;font-size:11px}
`;

        const js = `
const vscode = acquireVsCodeApi();

document.addEventListener('click', e => {
    const target = e.target.closest('button');
    if (!target) return;
    if (target.id === 'btn-connect') vscode.postMessage({ type: 'connect' });
    else if (target.id === 'btn-run-setup') vscode.postMessage({ type: 'runSetup' });
    else if (target.id === 'btn-check-config') vscode.postMessage({ type: 'checkConfig' });
    else if (target.id === 'btn-open-config') vscode.postMessage({ type: 'openConfigFile' });
    else if (target.id === 'btn-open-env') vscode.postMessage({ type: 'openEnvFile' });
});

window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'update') {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            let statusHtml = '';
            if (message.configStatus === 'checking') {
                statusHtml = '<div class="status checking">🔄 Checking configuration...</div>';
            } else if (message.configStatus === 'configured') {
                statusHtml = '<div class="status configured">✅ Hermes is installed & configured</div>';
            } else if (message.configStatus === 'not_configured') {
                statusHtml = '<div class="status not-configured">⚠️ Hermes not configured (run Setup)</div>';
            } else {
                statusHtml = '<div class="status error">❌ Error checking configuration</div>';
            }
            statusEl.innerHTML = statusHtml;
        }
        const homeEl = document.getElementById('hermes-home');
        if (homeEl && message.hermesHome) {
            homeEl.textContent = message.hermesHome;
        }
    }
});
`;

        let statusHtml = '';
        if (this.configStatus === 'checking') {
            statusHtml = '<div class="status checking">🔄 Checking configuration...</div>';
        } else if (this.configStatus === 'configured') {
            statusHtml = '<div class="status configured">✅ Hermes is installed & configured</div>';
        } else if (this.configStatus === 'not_configured') {
            statusHtml = '<div class="status not-configured">⚠️ Hermes not configured (run Setup)</div>';
        } else {
            statusHtml = '<div class="status error">❌ Error checking configuration</div>';
        }

        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'No workspace opened';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view?.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">${css}</style>
    <title>Hermes Setup</title>
</head>
<body>
    <div class="container">
        <h1><span>⚡</span> Hermes Agent</h1>
        <div id="status">${statusHtml}</div>
        
        <div class="section">
            <h2>Quick Actions</h2>
            <div class="buttons">
                <button id="btn-connect" class="primary">🔌 Connect to Hermes ACP</button>
                <button id="btn-run-setup">🔧 Run Hermes Setup Wizard</button>
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
            <h2>Environment Details</h2>
            <div class="info">
                <p><strong>Hermes Home:</strong> <br><code id="hermes-home">${this.hermesHome}</code></p>
                <p style="margin-top:6px;"><strong>Active Workspace:</strong> <br><code>${workspaceName}</code></p>
            </div>
        </div>

        <div class="section">
            <h2>Quick Tips</h2>
            <ul>
                <li>Run <code>hermes setup</code> to configure models & providers</li>
                <li>API keys: <code>${this.hermesHome}\\.env</code></li>
                <li>Config: <code>${this.hermesHome}\\config.yaml</code></li>
                <li>Sessions: <code>${this.hermesHome}\\state.db</code></li>
            </ul>
        </div>
    </div>
    <script nonce="${nonce}">${js}</script>
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
