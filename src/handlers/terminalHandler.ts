import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';

interface TerminalSession {
    terminal: vscode.Terminal;
    toolCallId: string;
    command: string;
    resolve: (output: string) => void;
    reject: (error: Error) => void;
}

export class TerminalHandler {
    private logger: Logger;
    private sessions = new Map<string, TerminalSession>();

    constructor(logger: Logger) {
        this.logger = logger;
    }

    async handleToolCall(toolCall: any): Promise<string> {
        const { name, args, kind, id } = toolCall;

        if (kind !== 'execute' && kind !== 'bash' && name !== 'terminal') {
            return '';
        }

        const command = args.command || args.cmd || '';
        const cwd = args.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        if (!command) {
            this.logger.warn('No command provided for terminal tool call');
            return '';
        }

        return new Promise((resolve, reject) => {
            const terminal = vscode.window.createTerminal({
                name: `Hermes: ${command.slice(0, 30)}`,
                cwd: vscode.Uri.file(cwd),
                hideFromUser: false
            });

            const session: TerminalSession = {
                terminal,
                toolCallId: id,
                command,
                resolve,
                reject
            };

            this.sessions.set(id, session);

            terminal.show();
            terminal.sendText(command, true);

            // Listen for terminal close
            const disposal = vscode.window.onDidCloseTerminal(closedTerminal => {
                if (closedTerminal === terminal) {
                    this.cleanupSession(id);
                    disposal.dispose();
                }
            });

            // Set timeout
            const timeout = setTimeout(() => {
                if (this.sessions.has(id)) {
                    this.cleanupSession(id);
                    disposal.dispose();
                    reject(new Error('Terminal command timed out'));
                }
            }, 300000); // 5 minutes

            // Store timeout for cleanup
            (session as any).timeout = timeout;
        });
    }

    private cleanupSession(toolCallId: string): void {
        const session = this.sessions.get(toolCallId);
        if (session) {
            if ((session as any).timeout) {
                clearTimeout((session as any).timeout);
            }
            session.terminal.dispose();
            this.sessions.delete(toolCallId);
        }
    }

    async executeCommand(command: string, cwd?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const terminalCwd = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const terminal = vscode.window.createTerminal({
                name: `Hermes: ${command.slice(0, 30)}`,
                cwd: terminalCwd,
                hideFromUser: true
            });

            const output = '';
            // Note: onDidWriteTerminalData is not available in all VS Code versions
            // We'll just wait for the terminal to close
            
            const closeDisposal = vscode.window.onDidCloseTerminal(closedTerminal => {
                if (closedTerminal === terminal) {
                    closeDisposal.dispose();
                    // For now, we can't capture output without onDidWriteTerminalData
                    resolve(output);
                }
            });

            terminal.show();
            terminal.sendText(command, true);

            // Timeout
            setTimeout(() => {
                closeDisposal.dispose();
                terminal.dispose();
                reject(new Error('Command timed out'));
            }, 300000);
        });
    }

    getActiveSessions(): TerminalSession[] {
        return Array.from(this.sessions.values());
    }

    cancelSession(toolCallId: string): boolean {
        const session = this.sessions.get(toolCallId);
        if (session) {
            session.terminal.sendText('\x03'); // Ctrl+C
            session.terminal.dispose();
            this.sessions.delete(toolCallId);
            return true;
        }
        return false;
    }

    cancelAll(): void {
        for (const [, session] of this.sessions) {
            session.terminal.sendText('\x03');
            session.terminal.dispose();
        }
        this.sessions.clear();
    }
}