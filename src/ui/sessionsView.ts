import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';

interface SessionInfo {
    sessionId: string;
    cwd: string;
    model: string;
    historyLen: number;
    title: string;
    updatedAt: string;
}

export class SessionsViewProvider implements vscode.TreeDataProvider<SessionItem> {
    private logger: Logger;
    private sessions: SessionInfo[] = [];
    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<SessionItem | undefined | null | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    constructor(private context: vscode.ExtensionContext, logger: Logger) {
        this.logger = logger;
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    setSessions(sessions: SessionInfo[]): void {
        this.sessions = sessions;
        this.refresh();
    }

    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SessionItem): Thenable<SessionItem[]> {
        if (!element) {
            return Promise.resolve(this.sessions.map(s => new SessionItem(s)));
        }
        return Promise.resolve([]);
    }

    getParent(_element: SessionItem): vscode.ProviderResult<SessionItem> {
        return null;
    }
}

class SessionItem extends vscode.TreeItem {
    constructor(session: SessionInfo) {
        super(session.title || session.sessionId.slice(0, 8), vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${session.sessionId}\nCWD: ${session.cwd}\nModel: ${session.model}\nMessages: ${session.historyLen}\nUpdated: ${session.updatedAt}`;
        this.description = `${session.historyLen} msgs · ${session.model}`;
        this.contextValue = 'session';
        this.command = {
            command: 'hermes.loadSession',
            title: 'Load Session',
            arguments: [session.sessionId]
        };
        this.iconPath = new vscode.ThemeIcon('history');
    }
}