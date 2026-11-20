import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
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
    attachments?: any[];
    displayKind?: string;
    errorMessage?: string;
    errorCode?: string;
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
    private selectedCwd: string | null = null;
    private isStreamingInsideThink: boolean = false;
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
    private activeRecorderProcess: ChildProcess | null = null;
    private activeRecordingOutputFile: string | null = null;
    private recordingTimer: NodeJS.Timeout | null = null;

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
        this.messages = messages.map(msg => {
            let content = msg.content || '';
            let thinking = msg.thinking || '';
            if (msg.role === 'assistant' && !thinking && typeof content === 'string' && content.includes('<think>')) {
                const parsed = this.extractThinkingAndContent(content);
                thinking = parsed.thinking || '';
                content = parsed.content;
            }
            return {
                id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: (msg.role || 'assistant') as any,
                content,
                timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
                toolCalls: msg.toolCalls,
                thinking,
                attachments: msg.attachments,
                displayKind: msg.displayKind,
                errorMessage: msg.errorMessage,
                errorCode: msg.errorCode
            };
        });
        this.pendingAgentMessage = '';
        this.pendingThinking = '';
        this.isStreamingInsideThink = false;
        this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };
        this.activeTab = 'chat';
        this.refresh();
        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'turnComplete',
                agentActivity: this.agentActivity
            });
        }
    }

    resetAgentActivity(): void {
        this.pendingAgentMessage = '';
        this.pendingThinking = '';
        this.isStreamingInsideThink = false;
        this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };
        this.refresh();
        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'turnComplete',
                agentActivity: this.agentActivity
            });
        }
    }

    addMessage(message: any): void {
        const chatMessage: ChatMessage = {
            id: message.id || `msg-${Date.now()}`,
            role: message.role || 'assistant',
            content: message.content || '',
            timestamp: new Date(),
            toolCalls: message.toolCalls,
            thinking: message.thinking,
            attachments: message.attachments,
            displayKind: message.displayKind
        };
        this.messages.push(chatMessage);
        this.refresh();
    }

    addAgentChunk(content: string): void {
        if (!content) return;

        let remaining = content;
        while (remaining.length > 0) {
            if (!this.isStreamingInsideThink) {
                const thinkStartIdx = remaining.indexOf('<think>');
                if (thinkStartIdx !== -1) {
                    const before = remaining.slice(0, thinkStartIdx);
                    if (before) {
                        this.appendAgentMessageContent(before);
                    }
                    this.isStreamingInsideThink = true;
                    remaining = remaining.slice(thinkStartIdx + 7);
                } else {
                    this.appendAgentMessageContent(remaining);
                    remaining = '';
                }
            } else {
                const thinkEndIdx = remaining.indexOf('</think>');
                if (thinkEndIdx !== -1) {
                    const thinkText = remaining.slice(0, thinkEndIdx);
                    if (thinkText) {
                        this.addThoughtChunk(thinkText);
                    }
                    this.isStreamingInsideThink = false;
                    remaining = remaining.slice(thinkEndIdx + 8);
                } else {
                    this.addThoughtChunk(remaining);
                    remaining = '';
                }
            }
        }
    }

    private appendAgentMessageContent(content: string): void {
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
        const id = toolCall.id || toolCall.toolCallId || toolCall.tool_call_id || `tc-${Date.now()}`;
        const rawName = toolCall.name || toolCall.title?.split(':')[0]?.trim() || toolCall.kind || 'tool';
        const rawArgs = toolCall.args || toolCall.rawInput || toolCall.arguments || (toolCall.locations ? { locations: toolCall.locations } : {});
        const skillCheck = this.detectSkillTool({ name: rawName, args: rawArgs });

        if (skillCheck.isSkill) {
            this.agentActivity = {
                state: 'writing_skill',
                label: `Writing Skill: ${skillCheck.skillName || 'Skill'}`,
                detail: skillCheck.skillName || ''
            };
        } else {
            this.agentActivity = {
                state: 'tool',
                label: `Tool: ${rawName}`,
                detail: rawName
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
        const existingIdx = lastMsg.toolCalls.findIndex((t: any) => t.id === id);
        const tcItem = {
            id,
            name: rawName,
            args: rawArgs,
            kind: toolCall.kind,
            status: 'running',
            title: toolCall.title,
            isSkill: skillCheck.isSkill,
            skillName: skillCheck.skillName
        };

        if (existingIdx !== -1) {
            lastMsg.toolCalls[existingIdx] = { ...lastMsg.toolCalls[existingIdx], ...tcItem };
        } else {
            lastMsg.toolCalls.push(tcItem);
        }

        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'toolCall',
                toolCall: tcItem,
                agentActivity: this.agentActivity
            });
        }
    }

    updateToolCall(update: any): void {
        const updateId = update.id || update.toolCallId || update.tool_call_id;
        let isSkillUpdate = false;
        const lastMsg = this.messages[this.messages.length - 1];
        const status = update.status === 'completed' ? 'done' : (update.status || 'done');
        const result = update.result || update.rawOutput || (update.content ? this.extractResultText(update.content) : undefined);

        if (lastMsg && lastMsg.toolCalls) {
            const toolCall = lastMsg.toolCalls.find(t => t.id === updateId);
            if (toolCall) {
                toolCall.status = status;
                toolCall.result = result;
                toolCall.error = update.error;
                if (toolCall.isSkill && (toolCall.status === 'done')) {
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
                update: {
                    id: updateId,
                    status,
                    result,
                    error: update.error
                },
                agentActivity: this.agentActivity
            });
        }
    }

    private extractResultText(content: any): string {
        if (!content) return '';
        if (typeof content === 'string') return content;
        if (content.text) return content.text;
        if (Array.isArray(content)) {
            return content.map(item => {
                if (typeof item === 'string') return item;
                if (item.text) return item.text;
                if (item.content) return this.extractResultText(item.content);
                return '';
            }).join('\n');
        }
        if (typeof content === 'object') {
            if (content.content) return this.extractResultText(content.content);
            try { return JSON.stringify(content, null, 2); } catch { return ''; }
        }
        return String(content);
    }

    private extractThinkingAndContent(rawText: string): { thinking?: string; content: string } {
        if (!rawText) return { content: '' };
        const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/i;
        const match = rawText.match(thinkRegex);
        if (match && match[1]) {
            const thinking = match[1].trim();
            const content = rawText.replace(thinkRegex, '').trim();
            return { thinking, content };
        }
        return { content: rawText };
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
        const activeModel = this.modelConfig?.current?.model || '';
        const activeProvider = this.modelConfig?.current?.provider || '';
        const maxContext = this.configService.resolveModelContextCeiling(
            activeModel,
            activeProvider,
            usage?.maxContextTokens || usage?.size
        );
        const prompt = usage?.promptTokens || usage?.prompt || 0;
        const completion = usage?.completionTokens || usage?.completion || 0;
        const total = usage?.totalTokens || usage?.total || (prompt + completion);
        const percentUsed = maxContext > 0 ? Math.min(100, Math.round((total / maxContext) * 1000) / 10) : 0;

        this.tokenUsage = {
            prompt,
            completion,
            total,
            maxContext,
            percentUsed,
            cachedTokens: usage?.cachedTokens
        };
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
                await this.sendPrompt(message.text, message.attachments);
                break;
            case 'pickAttachment':
                await this.handlePickAttachment();
                break;
            case 'getProjectFolders':
                await this.handleGetProjectFolders();
                break;
            case 'setCwd':
                if (message.cwd) {
                    await this.switchCwd(message.cwd);
                }
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
                            try {
                                await this.createNewSession();
                            } catch {}
                        }
                        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
                        ctx?.sessionsProvider?.refresh();
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
                await this.handleSaveModelConfig(message.provider, message.model, message.apiKey, message.baseUrl, message.reasoningEffort);
                break;
            case 'updateReasoningEffort':
                if (message.effort) {
                    await this.handleUpdateReasoningEffort(message.effort);
                }
                break;
            case 'transcribeVoice':
                if (message.audioData) {
                    await this.handleTranscribeVoice(message.audioData, message.mimeType);
                }
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
                    if (message.key === 'autoApprovePermissions') {
                        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
                        if (ctx) {
                            ctx.permissionHandler?.setAutoApprove(!!message.value);
                            ctx.statusBar?.setAutoApprove(!!message.value);
                            if (ctx.client) {
                                ctx.client.setAutoApprove(!!message.value);
                                const curSession = ctx.client.getCurrentSessionId();
                                if (curSession) {
                                    ctx.client.setSessionMode(curSession, message.value ? 'accept_edits' : 'default').catch(() => {});
                                }
                            }
                        }
                    }
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
            case 'startVoiceRecording':
                await this.startVoiceRecording();
                break;
            case 'stopVoiceRecording':
                await this.stopVoiceRecording();
                break;
            case 'clearChat':
            case 'clearHistory':
                await this.handleClearChat(message.sessionId);
                break;
            case 'compressContext':
                await this.handleCompressContext();
                break;
        }
    }

    private async handleSaveModelConfig(provider: string, model: string, apiKey?: string, baseUrl?: string, reasoningEffort?: string): Promise<void> {
        try {
            this.logger.info(`Updating model config: provider=${provider}, model=${model}, reasoningEffort=${reasoningEffort}`);
            const success = await this.configService.saveModelConfig(provider, model, apiKey, baseUrl, reasoningEffort);
            if (success) {
                const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
                if (ctx?.client && reasoningEffort) {
                    await ctx.client.setReasoningEffort(reasoningEffort, this.currentSessionId || undefined);
                }
                vscode.window.showInformationMessage(`Hermes model updated: ${model} on ${provider} (Reasoning: ${reasoningEffort || 'high'})`);
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

    private async handleUpdateReasoningEffort(effort: string): Promise<void> {
        try {
            this.logger.info(`Updating reasoning effort to: ${effort}`);
            const success = await this.configService.saveReasoningEffort(effort);
            if (success) {
                const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
                if (ctx?.client) {
                    await ctx.client.setReasoningEffort(effort, this.currentSessionId || undefined);
                }
                this.modelConfig = await this.configService.getModelConfig();
                this.refresh();
                vscode.window.showInformationMessage(`سطح استدلال هرمس روی "${effort}" تنظیم شد.`);
            }
        } catch (error) {
            this.logger.error('Failed to update reasoning effort', error);
        }
    }

    private async handleClearChat(sessionIdFromMsg?: string): Promise<void> {
        this.logger.info('Clearing conversation message history and active turn state...');
        const sid = sessionIdFromMsg || this.currentSessionId;
        this.messages = [];
        this.pendingAgentMessage = '';
        this.pendingThinking = '';
        this.isStreamingInsideThink = false;
        this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };

        try {
            await this.cancelTurn();
        } catch {}

        if (sid) {
            try {
                this.logger.info(`Purging message history for session ${sid} from DB...`);
                await this.sessionService.clearSessionMessages(sid);
                const target = this.allSessions.find(s => s.id === sid);
                if (target) {
                    target.messageCount = 0;
                }
            } catch (err) {
                this.logger.warn(`Failed to clear messages for session ${sid} from DB:`, err);
            }
            this.currentSessionId = sid;
        } else {
            await this.createNewSession();
        }

        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
        ctx?.sessionsProvider?.refresh();
        await this.loadDashboardData();
        this.refresh();

        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'chatCleared',
                sessionId: this.currentSessionId
            });
        }
    }

    private async handleCompressContext(): Promise<void> {
        if (!this.currentSessionId) {
            vscode.window.showWarningMessage('ابتدا یک گفتگو انتخاب کنید.');
            return;
        }
        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
        if (!ctx?.client) {
            vscode.window.showErrorMessage('اتصال به کلاینت هرمس برقرار نیست.');
            return;
        }

        try {
            this.logger.info(`Invoking context compression for session: ${this.currentSessionId}`);
            vscode.window.showInformationMessage('⏳ در حال فشرده‌سازی هوشمند کانتکست توسط هرمس...');
            await ctx.client.compressContext(this.currentSessionId);
            await this.loadSessionMessages(this.currentSessionId);
            await this.loadDashboardData();
            this.refresh();
            if (this.view?.webview) {
                this.view.webview.postMessage({
                    type: 'contextCompressed',
                    sessionId: this.currentSessionId
                });
            }
            vscode.window.showInformationMessage('✓ کانتکست با موفقیت فشرده شد و حافظه آزاد گردید.');
        } catch (error: any) {
            this.logger.error('Failed to compress context:', error);
            vscode.window.showErrorMessage(`خطا در فشرده‌سازی کانتکست: ${error?.message || error}`);
        }
    }

    private async startVoiceRecording(): Promise<void> {
        try {
            if (this.activeRecorderProcess) {
                this.logger.warn('Recording already in progress, stopping previous...');
                await this.stopVoiceRecording();
            }

            const tempDir = os.tmpdir();
            const outputFile = path.join(tempDir, `hermes_voice_${Date.now()}.wav`);
            this.activeRecordingOutputFile = outputFile;

            const scriptPath = path.join(__dirname, 'utils', 'recordAudio.ps1');
            const fallbackScriptPath = path.join(__dirname, '..', 'src', 'utils', 'recordAudio.ps1');
            const finalScriptPath = fs.existsSync(scriptPath) ? scriptPath : fallbackScriptPath;

            this.logger.info(`Starting voice recording via PowerShell script: ${finalScriptPath} -> ${outputFile}`);

            const proc = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', finalScriptPath,
                '-OutputFile', outputFile
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.activeRecorderProcess = proc;

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                this.logger.info(`Voice recorder stdout: ${str.trim()}`);
                if (str.includes('HERMES_RECORDING_STARTED')) {
                    if (this.view?.webview) {
                        this.view.webview.postMessage({
                            type: 'voiceRecordingState',
                            state: 'recording'
                        });
                    }
                }
            });

            proc.stderr.on('data', (data) => {
                this.logger.warn(`Voice recorder stderr: ${data.toString()}`);
            });

            proc.on('close', (code) => {
                this.logger.info(`Voice recorder process closed with code ${code}`);
                this.activeRecorderProcess = null;
            });

            // Auto-stop after 90 seconds max safety limit
            if (this.recordingTimer) clearTimeout(this.recordingTimer);
            this.recordingTimer = setTimeout(() => {
                if (this.activeRecorderProcess) {
                    this.logger.info('Voice recording reached max duration (90s), auto-stopping...');
                    this.stopVoiceRecording();
                }
            }, 90000);

        } catch (error: any) {
            this.logger.error('Failed to start voice recording', error);
            if (this.view?.webview) {
                this.view.webview.postMessage({
                    type: 'voiceRecordingState',
                    state: 'error',
                    error: error?.message || 'خطا در شروع ضبط صدا'
                });
            }
        }
    }

    private async stopVoiceRecording(): Promise<void> {
        if (this.recordingTimer) {
            clearTimeout(this.recordingTimer);
            this.recordingTimer = null;
        }

        const proc = this.activeRecorderProcess;
        const outputFile = this.activeRecordingOutputFile;
        this.activeRecorderProcess = null;

        if (!proc) {
            this.logger.warn('No active recording process to stop.');
            if (this.view?.webview) {
                this.view.webview.postMessage({
                    type: 'voiceRecordingState',
                    state: 'idle'
                });
            }
            return;
        }

        try {
            this.logger.info('Stopping voice recording...');
            if (this.view?.webview) {
                this.view.webview.postMessage({
                    type: 'voiceRecordingState',
                    state: 'processing'
                });
            }

            try {
                if (proc.stdin) {
                    proc.stdin.write('STOP\n');
                    proc.stdin.end();
                }
            } catch (e) {
                this.logger.warn('Error writing STOP to recorder stdin', e);
            }

            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    try { proc.kill(); } catch {}
                    resolve();
                }, 3000);
                proc.on('close', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });

            await new Promise(r => setTimeout(r, 200));

            if (!outputFile || !fs.existsSync(outputFile)) {
                throw new Error('فایل صوتی ذخیره نشد یا خالی است.');
            }

            const stats = fs.statSync(outputFile);
            this.logger.info(`Recorded WAV file size: ${stats.size} bytes`);

            if (stats.size <= 44) {
                throw new Error('صدایی ضبط نشد (فایل خالی است). لطفاً میکروفون و دسترسی ورودی صدای سیستم را بررسی نمایید.');
            }

            const audioBuffer = fs.readFileSync(outputFile);
            const base64Data = audioBuffer.toString('base64');
            const isVoiceModel = this.isVoiceCapableModel(this.modelConfig?.current?.model || '');

            if (isVoiceModel) {
                const attachment = {
                    id: `voice-${Date.now()}`,
                    name: `voice-note-${new Date().toLocaleTimeString().replace(/:/g, '-')}.wav`,
                    path: outputFile,
                    type: 'file',
                    mimeType: 'audio/wav',
                    size: stats.size,
                    content: `[یادداشت صوتی کاربر / Voice Note: ${path.basename(outputFile)}]`
                };
                if (this.view?.webview) {
                    this.view.webview.postMessage({
                        type: 'voiceAttachmentResult',
                        attachment
                    });
                }
                return;
            }

            let transcribedText = '';
            try {
                transcribedText = await this.performSpeechToText(base64Data, 'audio/wav');
            } catch (sttError: any) {
                this.logger.warn(`Speech-to-text failed: ${sttError?.message || sttError}`);
            }

            if (transcribedText) {
                if (this.view?.webview) {
                    this.view.webview.postMessage({
                        type: 'voiceTranscriptionResult',
                        success: true,
                        text: transcribedText
                    });
                }
            } else {
                const attachment = {
                    id: `voice-${Date.now()}`,
                    name: `voice-note-${new Date().toLocaleTimeString().replace(/:/g, '-')}.wav`,
                    path: outputFile,
                    type: 'file',
                    mimeType: 'audio/wav',
                    size: stats.size,
                    content: `[یادداشت صوتی کاربر / Voice Note (${(stats.size / 1024).toFixed(0)} KB)]`
                };
                if (this.view?.webview) {
                    this.view.webview.postMessage({
                        type: 'voiceAttachmentResult',
                        attachment,
                        warning: 'تبدیل خودکار صوت به متن به دلیل عدم دسترسی یا کلید معتبر انجام نشد؛ صوت به صورت فایل پیوست به پیام افزوده شد.'
                    });
                }
            }
        } catch (err: any) {
            this.logger.error('Error stopping voice recorder', err);
            if (this.view?.webview) {
                this.view.webview.postMessage({
                    type: 'voiceRecordingState',
                    state: 'error',
                    error: err?.message || 'خطا در پردازش ضبط صدا'
                });
            }
        } finally {
            if (this.view?.webview) {
                this.view.webview.postMessage({
                    type: 'voiceRecordingState',
                    state: 'idle'
                });
            }
        }
    }

    private isVoiceCapableModel(modelName: string): boolean {
        if (!modelName) return false;
        const m = modelName.toLowerCase();
        return m.includes('audio') || m.includes('realtime') || m.includes('voice') || m.includes('omni');
    }

    private async performSpeechToText(audioData: string, mimeType: string): Promise<string> {
        const env = await this.configService.readEnv();
        const googleKey = env['GOOGLE_API_KEY'] || env['GEMINI_API_KEY'] || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        const groqKey = env['GROQ_API_KEY'] || process.env.GROQ_API_KEY;
        const openaiKey = env['OPENAI_API_KEY'] || env['VOICE_TOOLS_OPENAI_KEY'] || process.env.OPENAI_API_KEY;

        const cleanMime = (mimeType && mimeType.split(';')[0]) ? mimeType.split(';')[0]!.trim() : 'audio/wav';

        if (googleKey) {
            try {
                this.logger.info('Transcribing audio via Google Gemini Fast Flash...');
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-goog-api-key': googleKey
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                {
                                    inline_data: {
                                        mime_type: cleanMime,
                                        data: audioData
                                    }
                                },
                                {
                                    text: 'Transcribe the spoken audio verbatim in the original spoken language. Output ONLY the exact transcribed words.'
                                }
                            ]
                        }],
                        generationConfig: { temperature: 0.1 }
                    })
                });
                if (response.ok) {
                    const resData = await response.json() as any;
                    const text = resData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                    if (text) return text;
                }
            } catch (e) {
                this.logger.warn('Google STT attempt error', e);
            }
        }

        if (groqKey) {
            try {
                this.logger.info('Transcribing audio via Groq Whisper...');
                const buffer = Buffer.from(audioData, 'base64');
                const formData = new FormData();
                formData.append('file', new Blob([buffer], { type: 'audio/wav' }), 'audio.wav');
                formData.append('model', 'whisper-large-v3-turbo');
                formData.append('response_format', 'text');

                const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}` },
                    body: formData
                });
                if (response.ok) {
                    const text = (await response.text()).trim();
                    if (text) return text;
                }
            } catch (e) {
                this.logger.warn('Groq Whisper STT attempt error', e);
            }
        }

        if (openaiKey) {
            try {
                this.logger.info('Transcribing audio via OpenAI Whisper...');
                const buffer = Buffer.from(audioData, 'base64');
                const formData = new FormData();
                formData.append('file', new Blob([buffer], { type: 'audio/wav' }), 'audio.wav');
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'text');

                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${openaiKey}` },
                    body: formData
                });
                if (response.ok) {
                    const text = (await response.text()).trim();
                    if (text) return text;
                }
            } catch (e) {
                this.logger.warn('OpenAI Whisper STT attempt error', e);
            }
        }

        return '';
    }

    private async handleTranscribeVoice(audioData: string, mimeType: string): Promise<void> {
        try {
            const transcribedText = await this.performSpeechToText(audioData, mimeType);
            if (transcribedText) {
                if (this.view?.webview) {
                    this.view.webview.postMessage({
                        type: 'voiceTranscriptionResult',
                        success: true,
                        text: transcribedText
                    });
                }
            } else {
                throw new Error('صدایی در فایل ضبط شده تشخیص داده نشد یا کلید معتبر تنظیم نشده است.');
            }
        } catch (error: any) {
            this.logger.error('Failed to transcribe voice', error);
            if (this.view?.webview) {
                this.view.webview.postMessage({
                    type: 'voiceTranscriptionResult',
                    success: false,
                    error: error?.message || 'خطا در تبدیل صوت به متن'
                });
            }
        }
    }
    private async handlePickAttachment(): Promise<void> {
        try {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: true,
                openLabel: 'پیوست به گفتگو / Attach',
                filters: {
                    'All Supported Files': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'txt', 'md', 'json', 'yaml', 'yml', 'py', 'ts', 'js', 'html', 'css', 'pdf', 'log'],
                    'Images': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
                    'Code & Documents': ['txt', 'md', 'json', 'yaml', 'yml', 'py', 'ts', 'js', 'html', 'css', 'pdf', 'log']
                }
            });

            if (uris && uris.length > 0) {
                const attachments = await Promise.all(uris.map(async (u) => {
                    const stat = await vscode.workspace.fs.stat(u);
                    const ext = path.extname(u.fsPath).toLowerCase();
                    const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext);
                    const rawData = await vscode.workspace.fs.readFile(u);
                    if (isImage) {
                        const base64 = Buffer.from(rawData).toString('base64');
                        const mimeType = ext === '.svg' ? 'image/svg+xml' : ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
                        return {
                            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            name: path.basename(u.fsPath),
                            path: u.fsPath,
                            size: stat.size,
                            type: 'image',
                            mimeType,
                            data: base64
                        };
                    } else {
                        const textContent = Buffer.from(rawData).toString('utf8');
                        return {
                            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            name: path.basename(u.fsPath),
                            path: u.fsPath,
                            size: stat.size,
                            type: 'file',
                            content: textContent
                        };
                    }
                }));

                if (this.view?.webview) {
                    this.view.webview.postMessage({
                        type: 'attachmentsSelected',
                        attachments
                    });
                }
            }
        } catch (error) {
            this.logger.error('Failed to pick attachment', error);
        }
    }

    private async handleGetProjectFolders(): Promise<void> {
        const folders = await this.listProjectDirectories();
        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'projectFolders',
                folders,
                currentCwd: this.getCurrentCwd()
            });
        }
    }

    private getCurrentCwd(): string {
        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
        return this.selectedCwd || ctx?.config?.get('cwd', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()) || '';
    }

    private async switchCwd(newCwd: string): Promise<void> {
        this.selectedCwd = newCwd;
        const dirName = path.basename(newCwd) || newCwd;
        vscode.window.showInformationMessage(`دایرکتوری فعال به ${dirName} تغییر یافت.`);
        
        // Add a clean notice to the chat timeline without wiping history or opening a new chat
        this.addMessage({
            role: 'system',
            content: `📁 **مسیر کاری به \`${dirName}\` تغییر یافت.** (فرامین و ابزارهای بعدی در این مسیر اجرا می‌شوند)`
        });

        // Do NOT send any prompt to the model here (a directory change is a local editor context change, not an LLM prompt)
        this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };
        this.refresh();
        if (this.view?.webview) {
            this.view.webview.postMessage({
                type: 'turnComplete',
                agentActivity: this.agentActivity
            });
        }
        await this.handleGetProjectFolders();
    }

    private async listProjectDirectories(): Promise<Array<{ name: string; path: string; isRoot: boolean }>> {
        const list: Array<{ name: string; path: string; isRoot: boolean }> = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return list;

        for (const wf of workspaceFolders) {
            list.push({
                name: `[Root] ${wf.name}`,
                path: wf.uri.fsPath,
                isRoot: true
            });
            try {
                const entries = await vscode.workspace.fs.readDirectory(wf.uri);
                for (const [name, type] of entries) {
                    if (type === vscode.FileType.Directory && !name.startsWith('.') && name !== 'node_modules' && name !== 'dist' && name !== 'venv' && name !== '__pycache__') {
                        list.push({
                            name: `${name}/`,
                            path: path.join(wf.uri.fsPath, name),
                            isRoot: false
                        });
                    }
                }
            } catch (err) {
                this.logger.debug('Error listing workspace subdirectories', err);
            }
        }
        return list;
    }

    private async sendPrompt(text: string, attachments?: any[]): Promise<void> {
        if (!text.trim() && (!attachments || attachments.length === 0)) return;

        let promptText = text.trim();
        const voiceAttachment = attachments?.find(a => (a.mimeType && a.mimeType.startsWith('audio/')) || (a.name && a.name.endsWith('.wav')));
        if (!promptText && voiceAttachment) {
            promptText = `[پیام صوتی ضمیمه شده است: ${voiceAttachment.name}]\nلطفاً پیام صوتی پیوست‌شده را بررسی کرده و پاسخ دهید.`;
        }

        this.addMessage({ role: 'user', content: text.trim() || promptText, attachments });
        this.pendingAgentMessage = '';
        this.pendingThinking = '';
        this.isStreamingInsideThink = false;
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
                    const sessionCwd = this.getCurrentCwd();
                    const session = await ctx.client.createSession(sessionCwd);
                    this.currentSessionId = session.sessionId;
                    this.sessionTitle = session.title || session.sessionId.slice(0, 8);
                    ctx.currentSessionId = session.sessionId;
                    ctx.sessionManager?.setCurrentSession(session.sessionId);
                    ctx.statusBar?.setSession(session.sessionId);
                    ctx.sessionsProvider?.refresh();
                }

                // If non-image file attachments exist, augment prompt text cleanly so all models can read them
                let effectivePrompt = promptText;
                if (attachments && attachments.length > 0) {
                    const textAttachments = attachments.filter(a => a.type === 'file' && a.content);
                    if (textAttachments.length > 0) {
                        const fileBlocks = textAttachments.map(a => `\n\n--- [Attached File: ${a.name} (${a.path})] ---\n${a.content}\n--- [End File: ${a.name}] ---`).join('\n');
                        effectivePrompt = `${promptText}\n${fileBlocks}`.trim();
                    }
                }

                if (this.selectedCwd) {
                    effectivePrompt = `[Active Working Directory: ${this.selectedCwd}]\n${effectivePrompt}`;
                }

                await ctx.client.sendPrompt(this.currentSessionId, effectivePrompt, attachments);
            } catch (error: any) {
                this.logger.error('Failed to send prompt', error);
                const errMsg = error?.message || String(error);
                const lastMsg = this.messages[this.messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content && !lastMsg.thinking) {
                    lastMsg.displayKind = 'failed_turn';
                    lastMsg.content = `خطا در پردازش درخواست: ${errMsg}`;
                    lastMsg.errorMessage = errMsg;
                    lastMsg.errorCode = errMsg.includes('429') ? 'rate_limit' : errMsg.includes('401') ? 'auth_error' : 'error';
                } else {
                    this.addMessage({ 
                        role: 'assistant', 
                        content: `خطا در پردازش درخواست: ${errMsg}`,
                        displayKind: 'failed_turn',
                        errorMessage: errMsg,
                        errorCode: errMsg.includes('429') ? 'rate_limit' : errMsg.includes('401') ? 'auth_error' : 'error'
                    });
                }
            } finally {
                this.agentActivity = { state: 'idle', label: this.connected ? 'Local CLI' : 'Disconnected', detail: '' };
                if (this.currentSessionId && this.sessionService) {
                    try {
                        const dbMessages = await this.sessionService.getSessionMessages(this.currentSessionId);
                        if (dbMessages && dbMessages.length > 0) {
                            this.messages = dbMessages.map((msg: any) => {
                                let content = msg.content || '';
                                let thinking = msg.thinking || '';
                                if (msg.role === 'assistant' && !thinking && typeof content === 'string' && content.includes('<think>')) {
                                    const parsed = this.extractThinkingAndContent(content);
                                    thinking = parsed.thinking || '';
                                    content = parsed.content;
                                }
                                return {
                                    id: msg.id,
                                    role: msg.role,
                                    content,
                                    timestamp: msg.timestamp,
                                    toolCalls: msg.toolCalls,
                                    thinking,
                                    displayKind: msg.displayKind,
                                    errorMessage: msg.errorMessage,
                                    errorCode: msg.errorCode
                                };
                            });
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

    private async createNewSession(customCwd?: string): Promise<void> {
        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
        if (ctx?.client) {
            const cwd = customCwd || this.getCurrentCwd();
            const session = await ctx.client.createSession(cwd);
            this.setSession(session.sessionId, session.title || session.sessionId.slice(0, 8));
            ctx.currentSessionId = session.sessionId;
            ctx.sessionManager?.setCurrentSession(session.sessionId);
            ctx.statusBar?.setSession(session.sessionId);
            ctx.sessionsProvider?.refresh();
            if (this.modelConfig?.current?.reasoningEffort) {
                ctx.client.setReasoningEffort(this.modelConfig.current.reasoningEffort, session.sessionId).catch(() => {});
            }
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
            const currentCwd = this.getCurrentCwd();
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
                    cwd: currentCwd,
                    version: this.context.extension?.packageJSON?.version || '1.0.4'
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
