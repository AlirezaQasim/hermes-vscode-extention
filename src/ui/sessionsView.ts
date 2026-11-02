import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { HermesDatabase, type HermesSession } from '../config/hermesConfig';

export interface SessionInfo {
    sessionId: string;
    cwd: string;
    model: string;
    historyLen: number;
    title: string;
    updatedAt: string | number;
    source?: string | undefined;
}

export class SessionsViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private logger: Logger;
    private hermesDb: HermesDatabase;
    private sessions: SessionInfo[] = [];
    private isLoading = false;
    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    constructor(private context: vscode.ExtensionContext, logger: Logger) {
        this.logger = logger;
        this.hermesDb = new HermesDatabase(logger);
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    setSessions(sessions: SessionInfo[]): void {
        this.sessions = sessions;
        this.refresh();
    }

    async loadSessions(): Promise<SessionInfo[]> {
        if (this.isLoading) return this.sessions;
        this.isLoading = true;
        try {
            const dbSessions = await this.hermesDb.getSessions(50);
            if (dbSessions && dbSessions.length > 0) {
                this.sessions = dbSessions.map(s => ({
                    sessionId: s.id,
                    title: s.title || s.id,
                    cwd: s.cwd || '',
                    model: s.model || '',
                    historyLen: s.messageCount || 0,
                    updatedAt: s.updatedAt || s.createdAt || Date.now(),
                    source: s.source
                }));
            }
        } catch (error) {
            this.logger.error('Failed to load sessions from DB', error);
        } finally {
            this.isLoading = false;
            this.refresh();
        }
        return this.sessions;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            if (this.sessions.length === 0 && !this.isLoading) {
                await this.loadSessions();
            }

            if (this.sessions.length === 0) {
                const emptyItem = new vscode.TreeItem('No past sessions found');
                emptyItem.description = 'Click + to start chatting';
                emptyItem.iconPath = new vscode.ThemeIcon('info');
                return [emptyItem];
            }

            return this.sessions.map(s => new SessionItem(s));
        }
        return [];
    }

    getParent(_element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
        return null;
    }
}

class SessionItem extends vscode.TreeItem {
    constructor(session: SessionInfo) {
        super(session.title || session.sessionId.slice(0, 8), vscode.TreeItemCollapsibleState.None);
        
        const timeStr = formatRelativeTime(session.updatedAt);
        const shortModelName = cleanModelName(session.model);

        this.tooltip = new vscode.MarkdownString(
            `### ${session.title || 'Session'}\n\n` +
            `- **ID:** \`${session.sessionId}\`\n` +
            `- **Model:** ${session.model || 'Default'}\n` +
            `- **Messages:** ${session.historyLen}\n` +
            `- **Folder:** \`${session.cwd}\`\n` +
            `- **Active:** ${timeStr}\n\n` +
            `*Click to resume and continue this conversation.*`
        );
        this.description = `${session.historyLen} msgs · ${shortModelName} · ${timeStr}`;
        this.contextValue = 'session';
        this.command = {
            command: 'hermes.loadSession',
            title: 'Resume Session',
            arguments: [session.sessionId]
        };
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
    }
}

function cleanModelName(model: string): string {
    if (!model) return 'Agent';
    const parts = model.split('/');
    const name = parts[parts.length - 1] || model;
    return name.replace(/:free$/, '').slice(0, 18);
}

function formatRelativeTime(ts: string | number): string {
    const time = typeof ts === 'string' ? (isNaN(Number(ts)) ? new Date(ts).getTime() : Number(ts) * (ts.length === 10 ? 1000 : 1)) : ts;
    if (!time || isNaN(time)) return '';

    const now = Date.now();
    const diffMs = now - time;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffDay > 30) {
        return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else if (diffDay > 0) {
        return `${diffDay}d ago`;
    } else if (diffHr > 0) {
        return `${diffHr}h ago`;
    } else if (diffMin > 0) {
        return `${diffMin}m ago`;
    } else {
        return 'Just now';
    }
}
