import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private tokenUsageItem: vscode.StatusBarItem;
    private modeItem: vscode.StatusBarItem;
    private autoApproveItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'hermes.openChat';
        this.statusBarItem.tooltip = 'Hermes Agent - Click to open chat';
        this.statusBarItem.show();

        this.tokenUsageItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.tokenUsageItem.show();

        this.modeItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.modeItem.show();

        this.autoApproveItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            98
        );
        this.autoApproveItem.show();

        this.setDisconnected('Not connected');
    }

    setConnecting(): void {
        this.statusBarItem.text = '$(sync~spin) Hermes: Connecting...';
        this.statusBarItem.color = undefined;
        this.statusBarItem.backgroundColor = undefined;
    }

    setConnected(): void {
        this.statusBarItem.text = '$(plug) Hermes: Connected';
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    }

    setDisconnected(reason: string): void {
        this.statusBarItem.text = '$(plug-off) Hermes: Disconnected';
        this.statusBarItem.tooltip = `Hermes Agent - ${reason} - Click to connect`;
        this.statusBarItem.color = undefined;
        this.statusBarItem.backgroundColor = undefined;
        this.tokenUsageItem.text = '';
        this.modeItem.text = '';
        this.autoApproveItem.text = '';
    }

    setError(error: string): void {
        this.statusBarItem.text = '$(error) Hermes: Error';
        this.statusBarItem.tooltip = `Hermes Agent Error: ${error}`;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    setSession(sessionId: string): void {
        this.statusBarItem.text = `$(plug) Hermes: ${sessionId.slice(0, 8)}...`;
        this.statusBarItem.tooltip = `Hermes Agent - Session: ${sessionId} - Click to open chat`;
    }

    updateTokenUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
        const total = usage.totalTokens || 0;
        const prompt = usage.promptTokens || 0;
        const completion = usage.completionTokens || 0;

        if (total > 0) {
            this.tokenUsageItem.text = `$(graph) ${this.formatTokens(total)} tokens (${this.formatTokens(prompt)}+${this.formatTokens(completion)})`;
            
            // Color code based on usage
            if (total > 800000) {
                this.tokenUsageItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
            } else if (total > 500000) {
                this.tokenUsageItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
            } else {
                this.tokenUsageItem.color = undefined;
            }
        } else {
            this.tokenUsageItem.text = '';
        }
    }

    setMode(mode: string): void {
        this.modeItem.text = `$(beaker) ${mode}`;
    }

    setAutoApprove(enabled: boolean): void {
        if (enabled) {
            this.autoApproveItem.text = '$(shield-check) Auto-approve';
            this.autoApproveItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        } else {
            this.autoApproveItem.text = '';
        }
    }

    private formatTokens(count: number): string {
        if (count >= 1000000) {
            return (count / 1000000).toFixed(1) + 'M';
        } else if (count >= 1000) {
            return (count / 1000).toFixed(1) + 'K';
        }
        return count.toString();
    }

    dispose(): void {
        this.statusBarItem.dispose();
        this.tokenUsageItem.dispose();
        this.modeItem.dispose();
        this.autoApproveItem.dispose();
    }
}