import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: Date;
    toolCalls?: any[];
    thinking?: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'hermes.chat';
    private view?: vscode.WebviewView;
    private context: vscode.ExtensionContext;
    private logger: Logger;
    private messages: ChatMessage[] = [];
    private connected = false;
    private currentSessionId: string | null = null;
    private tokenUsage: { prompt: number; completion: number; total: number } | null = null;
    private pendingAgentMessage: string = '';
    private pendingThinking: string = '';

    constructor(context: vscode.ExtensionContext, logger: Logger) {
        this.context = context;
        this.logger = logger;
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

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.refresh();
            }
        });
    }

    setConnected(connected: boolean): void {
        this.connected = connected;
        this.refresh();
    }

    setSession(sessionId: string): void {
        this.currentSessionId = sessionId;
        this.messages = [];
        this.refresh();
    }

    addMessage(message: any): void {
        const chatMessage: ChatMessage = {
            id: message.id || `msg-${Date.now()}`,
            role: message.role || 'assistant',
            content: message.content || '',
            timestamp: new Date(),
            toolCalls: message.toolCalls,
            thinking: message.thinking
        };
        this.messages.push(chatMessage);
        this.refresh();
    }

    addAgentChunk(content: string): void {
        this.pendingAgentMessage += content;
        this.updateLastMessage(this.pendingAgentMessage);
    }

    addUserChunk(content: string): void {
        // User messages are typically sent as complete
        this.addMessage({ role: 'user', content });
    }

    addThinkingChunk(content: string): void {
        this.pendingThinking += content;
        this.updateLastMessageThinking(this.pendingThinking);
    }

    addThoughtChunk(content: string): void {
        this.pendingThinking += content;
        this.updateLastMessageThinking(this.pendingThinking);
    }

    private updateLastMessageThinking(thinking: string): void {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.thinking = thinking;
        }
        this.refresh();
    }

    addToolCall(toolCall: any): void {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.toolCalls = lastMsg.toolCalls || [];
            lastMsg.toolCalls.push({
                id: toolCall.id,
                name: toolCall.name,
                args: toolCall.args,
                kind: toolCall.kind,
                status: 'running',
                title: toolCall.title
            });
        } else {
            this.messages.push({
                id: `tool-${Date.now()}`,
                role: 'assistant',
                content: '',
                timestamp: new Date(),
                toolCalls: [{
                    id: toolCall.id,
                    name: toolCall.name,
                    args: toolCall.args,
                    kind: toolCall.kind,
                    status: 'running',
                    title: toolCall.title
                }]
            });
        }
        this.refresh();
    }

    updateToolCall(update: any): void {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.toolCalls) {
            const toolCall = lastMsg.toolCalls.find(t => t.id === update.id);
            if (toolCall) {
                toolCall.status = update.status || 'done';
                toolCall.result = update.result;
                toolCall.error = update.error;
            }
        }
        this.refresh();
    }

    addPlan(content: any): void {
        this.addMessage({
            role: 'system',
            content: `**Plan:**\n${typeof content === 'string' ? content : JSON.stringify(content, null, 2)}`
        });
    }

    updateCommands(commands: any[]): void {
        // Update available commands in UI
        this.refresh();
    }

    updateTokenUsage(usage: any): void {
        this.tokenUsage = usage;
        this.refresh();
    }

    private updateLastMessage(content: string): void {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = content;
        } else {
            this.messages.push({
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content,
                timestamp: new Date()
            });
        }
        this.refresh();
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'sendPrompt':
                await this.sendPrompt(message.text);
                break;
            case 'cancelTurn':
                await this.cancelTurn();
                break;
            case 'newSession':
                await this.createNewSession();
                break;
            case 'pickSkill':
                await this.pickSkill();
                break;
            case 'switchModel':
                await this.switchModel();
                break;
            case 'clearHistory':
                this.messages = [];
                this.pendingAgentMessage = '';
                this.pendingThinking = '';
                this.refresh();
                break;
        }
    }

    private async sendPrompt(text: string): Promise<void> {
        if (!text.trim()) return;

        this.addMessage({ role: 'user', content: text });
        this.pendingAgentMessage = '';
        this.pendingThinking = '';

        // Send to extension
        const ctx = (global as any).hermesExtensionContext;
        if (ctx?.client && this.currentSessionId) {
            try {
                await ctx.client.sendPrompt(this.currentSessionId, text);
            } catch (error) {
                this.logger.error('Failed to send prompt', error);
                this.addMessage({ role: 'system', content: `Error: ${error}` });
            }
        }
    }

    private async cancelTurn(): Promise<void> {
        const ctx = (global as any).hermesExtensionContext;
        if (ctx?.client && this.currentSessionId) {
            await ctx.client.cancelTurn(this.currentSessionId);
        }
    }

    private async createNewSession(): Promise<void> {
        const ctx = (global as any).hermesExtensionContext;
        if (ctx?.client) {
            const cwd = ctx.config.get('cwd', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
            const session = await ctx.client.createSession(cwd);
            this.setSession(session.sessionId);
        }
    }

    private async pickSkill(): Promise<void> {
        vscode.commands.executeCommand('hermes.pickSkill');
    }

    private async switchModel(): Promise<void> {
        vscode.commands.executeCommand('hermes.switchModel');
    }

    refresh(): void {
        if (this.view) {
            this.view.webview.postMessage({
                type: 'update',
                messages: this.messages,
                connected: this.connected,
                sessionId: this.currentSessionId,
                tokenUsage: this.tokenUsage
            });
        }
    }

    private getHtml(): string {
        const scriptUri = this.view?.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'chatView.js')
        ) || '';

        const styleUri = this.view?.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'chatView.css')
        ) || '';

        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view?.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${this.view?.webview.cspSource} data: https:; font-src ${this.view?.webview.cspSource};">
    <link href="${styleUri}" rel="stylesheet">
    <title>Hermes Chat</title>
</head>
<body>
    <div id="chat-container">
        <div id="header" class="${this.connected ? 'connected' : 'disconnected'}">
            <div class="status">
                <span class="indicator"></span>
                <span class="text">${this.connected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div class="session-info">
                ${this.currentSessionId ? `<span class="session-id">${this.currentSessionId.slice(0, 8)}...</span>` : ''}
                ${this.tokenUsage ? `<span class="tokens">${this.tokenUsage.total} tokens</span>` : ''}
            </div>
        </div>
        <div id="messages" class="messages"></div>
        <div id="composer" class="composer">
            <div class="composer-toolbar">
                <button id="btn-new-session" title="New Session" ${!this.connected ? 'disabled' : ''}>+</button>
                <button id="btn-skill" title="Pick Skills" ${!this.connected ? 'disabled' : ''}>🔧</button>
                <button id="btn-model" title="Switch Model" ${!this.connected ? 'disabled' : ''}>🤖</button>
                <button id="btn-cancel" title="Cancel Turn" ${!this.connected ? 'disabled' : ''}>⏹</button>
                <button id="btn-clear" title="Clear History">🗑</button>
            </div>
            <div class="input-area">
                <textarea id="prompt-input" placeholder="${this.connected ? 'Type your message...' : 'Connect to Hermes first'}" ${!this.connected ? 'disabled' : ''}></textarea>
                <button id="btn-send" ${!this.connected ? 'disabled' : ''}>Send</button>
            </div>
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