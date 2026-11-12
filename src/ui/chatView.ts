import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../utils/logger';
import { getHermesSafeCwd } from '../utils/hermesPaths';
import { ConfigService, SessionService, SkillService } from '../services';

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
    private getContext?: (() => any) | undefined;
    private configService: ConfigService;
    private sessionService: SessionService;
    private skillService: SkillService;
    private messages: ChatMessage[] = [];
    private connected = false;
    private currentSessionId: string | null = null;
    private sessionTitle: string = '';
    private tokenUsage: { prompt: number; completion: number; total: number } | null = null;
    private pendingAgentMessage: string = '';
    private pendingThinking: string = '';
    private activeTab: 'chat' | 'sessions' | 'skills' | 'models' | 'settings' = 'chat';
    private allSessions: any[] = [];
    private allSkills: any[] = [];
    private modelConfig: any = null;
    private agentActivity: {
        state: 'idle' | 'thinking' | 'streaming' | 'tool' | 'writing_skill';
        label: string;
        detail?: string | undefined;
    } = {
        state: 'idle',
        label: 'Local CLI'
    };

    constructor(
        context: vscode.ExtensionContext,
        logger: Logger,
        getContext?: (() => any) | undefined,
        configService?: ConfigService,
        sessionService?: SessionService,
        skillService?: SkillService
    ) {
        this.context = context;
        this.logger = logger;
        this.getContext = getContext;
        this.configService = configService || new ConfigService(logger);
        this.sessionService = sessionService || new SessionService(logger);
        this.skillService = skillService || new SkillService(logger);

        // Hot-reload event when .env or config.yaml is edited in Notepad / terminal
        this.configService.on('configChanged', ({ modelConfig }) => {
            this.modelConfig = modelConfig;
            this.refresh();
        });
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
                this.loadDashboardData().then(() => this.refresh());
            }
        });

        // Initial background data load
        this.loadDashboardData().then(() => this.refresh());
    }

    setConnected(connected: boolean): void {
        this.connected = connected;
        if (!connected) {
            this.agentActivity = { state: 'idle', label: 'Disconnected', detail: '' };
        } else {
            this.agentActivity = { state: 'idle', label: 'Local CLI', detail: '' };
        }
        this.refresh();
    }

    setConnecting(): void {
        this.agentActivity = { state: 'tool', label: 'Connecting...', detail: 'Hermes ACP' };
        this.refresh();
    }

    setSession(sessionId: string, sessionTitle?: string): void {
        this.currentSessionId = sessionId;
        this.sessionTitle = sessionTitle || '';
        this.messages = [];
        this.pendingAgentMessage = '';
        this.pendingThinking = '';
        this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };
        this.refresh();
    }

    setActiveTab(tab: 'chat' | 'sessions' | 'skills' | 'models' | 'settings'): void {
        this.activeTab = tab;
        this.refresh();
    }

    loadMessages(sessionId: string, messages: any[], sessionTitle?: string): void {
        this.currentSessionId = sessionId;
        this.sessionTitle = sessionTitle || '';
        this.messages = messages.map(msg => ({
            id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: (msg.role || 'assistant') as any,
            content: msg.content || '',
            timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
            toolCalls: msg.toolCalls,
            thinking: msg.thinking
        }));
        this.pendingAgentMessage = '';
        this.pendingThinking = '';
        this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };
        this.activeTab = 'chat';
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
        this.agentActivity = { state: 'streaming', label: 'Responding...', detail: '' };

        let lastMsg = this.messages[this.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'assistant') {
            lastMsg = {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: this.pendingAgentMessage,
                timestamp: new Date()
            };
            this.messages.push(lastMsg);
        } else {
            lastMsg.content = this.pendingAgentMessage;
        }

        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'streamChunk',
                chunkType: 'content',
                text: content,
                content: this.pendingAgentMessage,
                agentActivity: this.agentActivity
            });
        }
    }

    addUserChunk(content: string): void {
        this.addMessage({ role: 'user', content });
    }

    addThinkingChunk(content: string): void {
        this.addThoughtChunk(content);
    }

    addThoughtChunk(content: string): void {
        this.pendingThinking += content;
        this.agentActivity = { state: 'thinking', label: 'Thinking...', detail: '' };

        let lastMsg = this.messages[this.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'assistant') {
            lastMsg = {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: '',
                thinking: this.pendingThinking,
                timestamp: new Date()
            };
            this.messages.push(lastMsg);
        } else {
            lastMsg.thinking = this.pendingThinking;
        }

        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'streamChunk',
                chunkType: 'thought',
                text: content,
                thinking: this.pendingThinking,
                agentActivity: this.agentActivity
            });
        }
    }

    private detectSkillTool(toolCall: any): { isSkill: boolean; skillName?: string } {
        if (!toolCall) return { isSkill: false };
        const name = (toolCall.name || '').toLowerCase();
        const args = toolCall.args || {};
        const pathStr = String(args.path || args.file_path || args.target || '').toLowerCase();

        if (name.includes('skill') || pathStr.includes('skills') || pathStr.includes('skill.md')) {
            let skillName: string | undefined = args.name || args.skill_name;
            if (!skillName && pathStr) {
                const parts = pathStr.replace(/\\/g, '/').split('/');
                const sIdx = parts.findIndex((p: string) => p.includes('skill'));
                const nextPart = sIdx !== -1 ? parts[sIdx + 1] : undefined;
                if (nextPart && !nextPart.endsWith('.md')) {
                    skillName = nextPart;
                } else if (parts.length > 1) {
                    const candidate = parts[parts.length - 2];
                    skillName = candidate && candidate !== 'skills' ? candidate : parts[parts.length - 1];
                }
            }
            return { isSkill: true, skillName: skillName || 'مهارت جدید' };
        }
        return { isSkill: false };
    }

    addToolCall(toolCall: any): void {
        const skillCheck = this.detectSkillTool(toolCall);
        if (skillCheck.isSkill) {
            this.agentActivity = {
                state: 'writing_skill',
                label: `Writing Skill: ${skillCheck.skillName || 'Skill'}`,
                detail: skillCheck.skillName || ''
            };
        } else {
            this.agentActivity = {
                state: 'tool',
                label: `Tool: ${toolCall.name || 'Running'}`,
                detail: toolCall.name || ''
            };
        }

        let lastMsg = this.messages[this.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'assistant') {
            lastMsg = {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: '',
                timestamp: new Date()
            };
            this.messages.push(lastMsg);
        }

        lastMsg.toolCalls = lastMsg.toolCalls || [];
        const tcItem = {
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.args,
            kind: toolCall.kind,
            status: 'running',
            title: toolCall.title,
            isSkill: skillCheck.isSkill,
            skillName: skillCheck.skillName
        };
        lastMsg.toolCalls.push(tcItem);

        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'toolCall',
                toolCall: tcItem,
                agentActivity: this.agentActivity
            });
        }
    }

    updateToolCall(update: any): void {
        let isSkillUpdate = false;
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.toolCalls) {
            const toolCall = lastMsg.toolCalls.find(t => t.id === update.id);
            if (toolCall) {
                toolCall.status = update.status || 'done';
                toolCall.result = update.result;
                toolCall.error = update.error;
                if (toolCall.isSkill && (update.status === 'done' || !update.status)) {
                    isSkillUpdate = true;
                }
            }
        }

        // If a skill was learned, reload SSD skills list so count updates immediately
        if (isSkillUpdate) {
            this.loadDashboardData().then(() => this.refresh());
        }

        const hasRunningTools = lastMsg?.toolCalls?.some((t: any) => t.status === 'running');
        if (!hasRunningTools) {
            if (this.pendingAgentMessage) {
                this.agentActivity = { state: 'streaming', label: 'Responding...', detail: '' };
            } else {
                this.agentActivity = { state: 'thinking', label: 'Thinking...', detail: '' };
            }
        }

        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'toolCallUpdate',
                update,
                agentActivity: this.agentActivity
            });
        }
    }

    addPlan(content: any): void {
        this.addMessage({
            role: 'system',
            content: `**Plan:**\n${typeof content === 'string' ? content : JSON.stringify(content, null, 2)}`
        });
    }

    updateCommands(_commands: any[]): void {
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

    async loadDashboardData(): Promise<void> {
        try {
            const [sessions, skills, modelConfig] = await Promise.all([
                this.sessionService.getSessions(50),
                this.skillService.getSkills(),
                this.configService.getModelConfig()
            ]);
            this.allSessions = sessions || [];
            this.allSkills = skills || [];
            this.modelConfig = modelConfig;
        } catch (error) {
            this.logger.error('Failed to load dashboard data', error);
        }
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
            case 'switchTab':
                this.activeTab = message.tab || 'chat';
                if (this.activeTab !== 'chat') {
                    await this.loadDashboardData();
                }
                this.refresh();
                break;
            case 'loadSession':
                if (message.sessionId) {
                    await vscode.commands.executeCommand('hermes.loadSession', message.sessionId);
                }
                break;
            case 'archiveSession':
                if (message.sessionId) {
                    const shouldArchive = message.archive !== undefined ? message.archive : true;
                    const success = await this.sessionService.archiveSession(message.sessionId, shouldArchive);
                    if (success) {
                        vscode.window.showInformationMessage(`وضعیت آرشیو گفتگوی ${message.sessionId.slice(0, 8)} به‌روز شد.`);
                        await this.loadDashboardData();
                        this.refresh();
                    } else {
                        vscode.window.showErrorMessage('خطا در تغییر وضعیت آرشیو گفتگو.');
                    }
                }
                break;
            case 'deleteSession':
                if (message.sessionId) {
                    const success = await this.sessionService.deleteSession(message.sessionId);
                    if (success) {
                        vscode.window.showInformationMessage(`گفتگوی ${message.sessionId.slice(0, 8)} برای همیشه حذف شد.`);
                        if (this.currentSessionId === message.sessionId) {
                            this.currentSessionId = null;
                            this.messages = [];
                        }
                        await this.loadDashboardData();
                        this.refresh();
                    } else {
                        vscode.window.showErrorMessage('خطا در حذف گفتگو.');
                    }
                }
                break;
            case 'openSkillFile':
                if (message.skillPath) {
                    await vscode.commands.executeCommand('hermes.openSkillFile', message.skillPath);
                }
                break;
            case 'injectSkill':
                if (message.skillName) {
                    await vscode.commands.executeCommand('hermes.injectSkill', message.skillName);
                    this.activeTab = 'chat';
                    this.refresh();
                }
                break;
            case 'getModelConfig':
                this.modelConfig = await this.configService.getModelConfig();
                this.refresh();
                break;
            case 'saveModelConfig':
                await this.handleSaveModelConfig(message.provider, message.model, message.apiKey, message.baseUrl);
                break;
            case 'toggleAutoApprove':
                await vscode.commands.executeCommand('hermes.toggleAutoApprove');
                this.refresh();
                break;
            case 'reconnect':
                this.setConnecting();
                await vscode.commands.executeCommand('hermes.connect');
                break;
            case 'runSetup':
            case 'runSetupTerminal':
                await vscode.commands.executeCommand('hermes.runSetup');
                break;
            case 'refreshDashboard':
            case 'refreshData':
                await this.loadDashboardData();
                this.refresh();
                break;
            case 'updateSetting':
                if (message.key) {
                    await vscode.workspace.getConfiguration('hermes').update(message.key, message.value, vscode.ConfigurationTarget.Global);
                    this.refresh();
                }
                break;
            case 'pickSkill':
                vscode.commands.executeCommand('hermes.pickSkill');
                break;
            case 'switchModel':
                this.activeTab = 'models';
                await this.loadDashboardData();
                this.refresh();
                break;
            case 'clearHistory':
                this.messages = [];
                this.pendingAgentMessage = '';
                this.pendingThinking = '';
                this.refresh();
                break;
        }
    }

    private async handleSaveModelConfig(provider: string, model: string, apiKey?: string, baseUrl?: string): Promise<void> {
        try {
            this.logger.info(`Updating model config: provider=${provider}, model=${model}`);
            const success = await this.configService.saveModelConfig(provider, model, apiKey, baseUrl);
            if (success) {
                vscode.window.showInformationMessage(`Hermes model updated: ${model} on ${provider}`);
                // Re-fetch model config
                this.modelConfig = await this.configService.getModelConfig();
                // Create a fresh new session using the new model
                await this.createNewSession();
                this.activeTab = 'chat';
                this.refresh();
            } else {
                vscode.window.showErrorMessage('Failed to update Hermes model configuration.');
            }
        } catch (error) {
            this.logger.error('Error saving model config', error);
        }
    }
    private async sendPrompt(text: string): Promise<void> {
        if (!text.trim()) return;

        this.addMessage({ role: 'user', content: text });
        this.pendingAgentMessage = '';
        this.pendingThinking = '';
        this.agentActivity = { state: 'thinking', label: 'Thinking...', detail: '' };

        // Create initial assistant placeholder for live millisecond token streaming
        const assistantMsg: ChatMessage = {
            id: `msg-${Date.now() + 1}`,
            role: 'assistant',
            content: '',
            thinking: '',
            timestamp: new Date()
        };
        this.messages.push(assistantMsg);
        this.refresh();

        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
        if (ctx?.client) {
            try {
                if (!this.currentSessionId) {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    const cwd = getHermesSafeCwd(ctx.config.get('cwd', '${workspaceFolder}'), workspaceFolder);
                    const session = await ctx.client.createSession(cwd);
                    this.currentSessionId = session.sessionId;
                    this.sessionTitle = session.title || session.sessionId.slice(0, 8);
                    ctx.currentSessionId = session.sessionId;
                    ctx.sessionManager.setCurrentSession(session.sessionId);
                    ctx.statusBar.setSession(session.sessionId);
                    ctx.sessionsProvider?.refresh();
                }
                await ctx.client.sendPrompt(this.currentSessionId, text);
            } catch (error) {
                this.logger.error('Failed to send prompt', error);
                this.addMessage({ role: 'system', content: `Error: ${error}` });
            } finally {
                this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };
                if (this.currentSessionId && this.sessionService) {
                    try {
                        const dbMessages = await this.sessionService.getSessionMessages(this.currentSessionId);
                        if (dbMessages && dbMessages.length > 0) {
                            this.messages = dbMessages.map((msg: any) => ({
                                id: msg.id,
                                role: msg.role,
                                content: msg.content,
                                timestamp: msg.timestamp,
                                toolCalls: msg.toolCalls,
                                thinking: msg.thinking,
                                displayKind: msg.displayKind
                            }));
                        }
                    } catch (e) {
                        this.logger.warn('Failed to sync session messages after turn', e);
                    }
                }
                this.refresh();
                if (this.view?.webview) {
                    this.view.webview.postMessage({ 
                        type: 'turnComplete',
                        agentActivity: this.agentActivity 
                    });
                }
            }
        } else {
            this.agentActivity = { state: 'idle', label: 'Disconnected', detail: '' };
            this.addMessage({ role: 'system', content: 'Hermes is not connected. Click "Connect to Hermes" first.' });
            this.refresh();
        }
    }

    private async cancelTurn(): Promise<void> {
        this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };
        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
        if (ctx?.client && this.currentSessionId) {
            await ctx.client.cancelTurn(this.currentSessionId);
        }
        this.refresh();
    }

    private async createNewSession(): Promise<void> {
        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
        if (ctx?.client) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const cwd = getHermesSafeCwd(ctx.config.get('cwd', '${workspaceFolder}'), workspaceFolder);
            const session = await ctx.client.createSession(cwd);
            this.setSession(session.sessionId, session.title || session.sessionId.slice(0, 8));
            ctx.currentSessionId = session.sessionId;
            ctx.sessionManager.setCurrentSession(session.sessionId);
            ctx.statusBar.setSession(session.sessionId);
            ctx.sessionsProvider?.refresh();
            await this.loadDashboardData();
            this.activeTab = 'chat';
            this.refresh();
        } else {
            this.currentSessionId = null;
            this.sessionTitle = '';
            this.messages = [];
            this.pendingAgentMessage = '';
            this.pendingThinking = '';
            this.activeTab = 'chat';
            this.refresh();
        }
    }

    refresh(): void {
        if (this.view) {
            const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
            const currentCwd = ctx?.config?.get('cwd', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()) || '';
            const autoApprove = ctx?.config?.get('autoApprovePermissions', false) || false;

            this.view.webview.postMessage({
                type: 'update',
                activeTab: this.activeTab,
                messages: this.messages,
                connected: this.connected,
                sessionId: this.currentSessionId,
                sessionTitle: this.sessionTitle,
                tokenUsage: this.tokenUsage,
                modelConfig: this.modelConfig,
                sessions: this.allSessions,
                skills: this.allSkills,
                agentActivity: this.agentActivity,
                config: {
                    autoApprove,
                    cwd: currentCwd
                }
            });
        }
    }

    private getCss(): string {
        try {
            const outPath = path.join(this.context.extensionPath, 'out', 'ui', 'chatView.css');
            if (fs.existsSync(outPath)) {
                return fs.readFileSync(outPath, 'utf8');
            }
            const srcPath = path.join(this.context.extensionPath, 'src', 'ui', 'chatView.css');
            if (fs.existsSync(srcPath)) {
                return fs.readFileSync(srcPath, 'utf8');
            }
        } catch (e) {
            this.logger.error('Failed to read chatView.css', e);
        }
        return '';
    }

    private getJs(): string {
        try {
            const outPath = path.join(this.context.extensionPath, 'out', 'ui', 'chatView.js');
            if (fs.existsSync(outPath)) {
                return fs.readFileSync(outPath, 'utf8');
            }
            const srcPath = path.join(this.context.extensionPath, 'src', 'ui', 'chatView.js');
            if (fs.existsSync(srcPath)) {
                return fs.readFileSync(srcPath, 'utf8');
            }
        } catch (e) {
            this.logger.error('Failed to read chatView.js', e);
        }
        return '';
    }

    private getHtml(): string {
        const nonce = this.getNonce();
        const css = this.getCss();
        const js = this.getJs();
        const cspSource = this.view?.webview.cspSource || '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; img-src ${cspSource} data: https:; font-src ${cspSource};">
    <style nonce="${nonce}">${css}</style>
    <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js"></script>
    <title>Hermes Agent Dashboard</title>
</head>
<body>
    <div id="app" style="height: 100%; width: 100%; display: flex; flex-direction: column; flex: 1 1 0%; min-height: 0; overflow: hidden;"></div>
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
