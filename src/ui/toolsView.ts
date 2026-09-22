import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';

interface ToolInfo {
    name: string;
    description: string;
    kind: string;
    parameters?: any;
}

export class ToolsViewProvider implements vscode.TreeDataProvider<ToolItem> {
    private logger: Logger;
    private tools: ToolInfo[] = [];
    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<ToolItem | undefined | null | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    constructor(private context: vscode.ExtensionContext, logger: Logger) {
        this.logger = logger;
        this.loadDefaultTools();
    }

    private loadDefaultTools(): void {
        // Default Hermes tools - these would come from the ACP agent
        this.tools = [
            { name: 'read_file', description: 'Read file contents', kind: 'read' },
            { name: 'write_file', description: 'Write file contents', kind: 'write' },
            { name: 'patch', description: 'Apply targeted edits', kind: 'edit' },
            { name: 'search_files', description: 'Search files by name or content', kind: 'search' },
            { name: 'terminal', description: 'Execute shell commands', kind: 'execute' },
            { name: 'web_search', description: 'Search the web', kind: 'fetch' },
            { name: 'web_extract', description: 'Extract content from URLs', kind: 'fetch' },
            { name: 'browser_exec', description: 'Control browser automation', kind: 'execute' },
            { name: 'delegate_task', description: 'Spawn subagents', kind: 'execute' },
            { name: 'skill_manage', description: 'Manage skills', kind: 'execute' },
            { name: 'memory', description: 'Manage persistent memory', kind: 'execute' },
            { name: 'cronjob', description: 'Manage scheduled jobs', kind: 'execute' },
            { name: 'todo_list', description: 'Manage task lists', kind: 'execute' },
            { name: 'patch', description: 'Apply patches', kind: 'edit' },
            { name: 'process_manage', description: 'Manage background processes', kind: 'execute' },
        ];
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    setTools(tools: ToolInfo[]): void {
        this.tools = tools;
        this.refresh();
    }

    getTreeItem(element: ToolItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ToolItem): Thenable<ToolItem[]> {
        if (!element) {
            return Promise.resolve(this.tools.map(t => new ToolItem(t)));
        }
        return Promise.resolve([]);
    }

    getParent(_element: ToolItem): vscode.ProviderResult<ToolItem> {
        return null;
    }
}

class ToolItem extends vscode.TreeItem {
    constructor(tool: ToolInfo) {
        super(tool.name, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${tool.name}\n${tool.description}\nKind: ${tool.kind}`;
        this.description = tool.description;
        this.contextValue = 'tool';
        this.iconPath = this.getIconForKind(tool.kind);
    }

    private getIconForKind(kind: string): vscode.ThemeIcon {
        switch (kind) {
            case 'read': return new vscode.ThemeIcon('file-text');
            case 'write': return new vscode.ThemeIcon('file-new');
            case 'edit': return new vscode.ThemeIcon('edit');
            case 'search': return new vscode.ThemeIcon('search');
            case 'execute': return new vscode.ThemeIcon('terminal');
            case 'fetch': return new vscode.ThemeIcon('globe');
            default: return new vscode.ThemeIcon('tools');
        }
    }
}