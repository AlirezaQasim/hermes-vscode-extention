import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { HermesConfig } from '../config/hermesConfig';

interface ConfigItem {
    key: string;
    value: any;
    description?: string;
}

export class ConfigViewProvider implements vscode.TreeDataProvider<ConfigItem> {
    private logger: Logger;
    private hermesConfig: HermesConfig;
    private _onDidChangeTreeData: vscode.EventEmitter<ConfigItem | undefined | null | void> = new vscode.EventEmitter<ConfigItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConfigItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(logger: Logger) {
        this.logger = logger;
        this.hermesConfig = new HermesConfig(logger);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConfigItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.key, vscode.TreeItemCollapsibleState.None);
        item.description = String(element.value);
        if (element.description) {
            item.tooltip = element.description;
        }
        item.iconPath = new vscode.ThemeIcon('symbol-property');
        return item;
    }

    async getChildren(_element?: ConfigItem): Promise<ConfigItem[]> {
        try {
            const config = await this.hermesConfig.readConfig();
            const items: ConfigItem[] = [];
            this.flattenConfig(config, '', items);
            return items;
        } catch (error) {
            this.logger.error('Failed to load config', error);
            return [{ key: 'Error', value: 'Failed to load configuration', description: String(error) }];
        }
    }

    private flattenConfig(obj: any, prefix: string, items: ConfigItem[]): void {
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                this.flattenConfig(value, fullKey, items);
            } else {
                items.push({ key: fullKey, value });
            }
        }
    }
}

export class ConnectionsViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private logger: Logger;
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(_element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        const items: vscode.TreeItem[] = [
            {
                label: 'ACP Connection',
                description: 'Hermes ACP Server',
                iconPath: new vscode.ThemeIcon('plug'),
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                command: {
                    command: 'hermes.checkACP',
                    title: 'Check ACP'
                }
            },
            {
                label: 'MCP Servers',
                description: 'Model Context Protocol servers',
                iconPath: new vscode.ThemeIcon('server'),
                collapsibleState: vscode.TreeItemCollapsibleState.None
            }
        ];
        return items;
    }
}