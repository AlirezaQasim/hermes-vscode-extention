import * as vscode from 'vscode';

export class ConfigManager {
    private config: vscode.WorkspaceConfiguration;

    constructor(private context: vscode.ExtensionContext) {
        this.config = vscode.workspace.getConfiguration('hermes');
    }

    reload(): void {
        this.config = vscode.workspace.getConfiguration('hermes');
    }

    get<T>(key: string, defaultValue: T): T {
        return this.config.get<T>(key, defaultValue);
    }

    async update(key: string, value: any, target?: vscode.ConfigurationTarget): Promise<void> {
        await this.config.update(key, value, target ?? vscode.ConfigurationTarget.Global);
        this.reload();
    }

    get enabled(): boolean {
        return this.get('enabled', true);
    }

    get acpCommand(): string {
        return this.get('acpCommand', 'hermes');
    }

    get acpArgs(): string[] {
        return this.get('acpArgs', ['acp']);
    }

    get cwd(): string {
        return this.get('cwd', '${workspaceFolder}');
    }

    get autoApprovePermissions(): boolean {
        return this.get('autoApprovePermissions', false);
    }

    get showTokenUsage(): boolean {
        return this.get('showTokenUsage', true);
    }

    get streamingEnabled(): boolean {
        return this.get('streamingEnabled', true);
    }

    get maxHistory(): number {
        return this.get('maxHistory', 100);
    }

    get skillsPath(): string {
        return this.get('skillsPath', '~/.hermes/skills');
    }

    get model(): string {
        return this.get('model', '');
    }

    get provider(): string {
        return this.get('provider', '');
    }

    get logLevel(): string {
        return this.get('logLevel', 'info');
    }
}