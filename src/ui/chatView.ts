import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../utils/logger';
import { getHermesSafeCwd } from '../utils/hermesPaths';
import { HermesDatabase } from '../config/hermesConfig';

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
    private hermesDb: HermesDatabase;
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

    constructor(context: vscode.ExtensionContext, logger: Logger, getContext?: (() => any) | undefined) {
        this.context = context;
        this.logger = logger;
        this.getContext = getContext;
        this.hermesDb = new HermesDatabase(logger);
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
        this.refresh();
    }

    setSession(sessionId: string, sessionTitle?: string): void {
        this.currentSessionId = sessionId;
        this.sessionTitle = sessionTitle || '';
        this.messages = [];
        this.pendingAgentMessage = '';
        this.pendingThinking = '';
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
        this.updateLastMessage(this.pendingAgentMessage);
    }

    addUserChunk(content: string): void {
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
                this.hermesDb.getSessions(50),
                this.hermesDb.getSkills(),
                this.hermesDb.getModelConfig()
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
                    const success = await this.hermesDb.archiveSession(message.sessionId, true);
                    if (success) {
                        vscode.window.showInformationMessage(`گفتگوی ${message.sessionId.slice(0, 8)} به بخش آرشیو منتقل شد.`);
                        await this.loadDashboardData();
                        this.refresh();
                    } else {
                        vscode.window.showErrorMessage('خطا در آرشیو گفتگو.');
                    }
                }
                break;
            case 'restoreSession':
                if (message.sessionId) {
                    const success = await this.hermesDb.archiveSession(message.sessionId, false);
                    if (success) {
                        vscode.window.showInformationMessage(`گفتگوی ${message.sessionId.slice(0, 8)} با موفقیت به چت‌های فعال بازگردانده شد.`);
                        await this.loadDashboardData();
                        this.refresh();
                    } else {
                        vscode.window.showErrorMessage('خطا در بازگردانی گفتگو.');
                    }
                }
                break;
            case 'deleteSession':
                if (message.sessionId) {
                    const success = await this.hermesDb.deleteSession(message.sessionId);
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
                this.modelConfig = await this.hermesDb.getModelConfig();
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
                await vscode.commands.executeCommand('hermes.connect');
                break;
            case 'runSetup':
                await vscode.commands.executeCommand('hermes.runSetup');
                break;
            case 'refreshDashboard':
                await this.loadDashboardData();
                this.refresh();
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
            const success = await this.hermesDb.saveModelConfig(provider, model, apiKey, baseUrl);
            if (success) {
                vscode.window.showInformationMessage(`Hermes model updated: ${model} on ${provider}`);
                // Re-fetch model config
                this.modelConfig = await this.hermesDb.getModelConfig();
                // Create a fresh new session using the new model
                await this.createNewSession();
                this.activeTab = 'chat';
                this.refresh();
            } else {
                vscode.window.showErrorMessage('Failed to update Hermes model configuration.');
            }
        } catch (error) {
            this.logger.error('Error saving model config', error);
            vscode.window.showErrorMessage(`Error saving model config: ${error}`);
        }
    }

    private async sendPrompt(text: string): Promise<void> {
        if (!text.trim()) return;

        this.addMessage({ role: 'user', content: text });
        this.pendingAgentMessage = '';
        this.pendingThinking = '';

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
            }
        } else {
            this.addMessage({ role: 'system', content: 'Hermes is not connected. Click "Connect to Hermes" first.' });
        }
    }

    private async cancelTurn(): Promise<void> {
        const ctx = this.getContext ? this.getContext() : (global as any).hermesExtensionContext;
        if (ctx?.client && this.currentSessionId) {
            await ctx.client.cancelTurn(this.currentSessionId);
        }
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
    <div id="app-container">
        <!-- Top HUD Capsule Navbar (Figma Style) -->
        <header id="dashboard-navbar" class="hud-navbar">
            <div class="brand">
                <span class="brand-logo">⚚</span>
                <div class="brand-titles">
                    <span class="brand-title">HERMES</span>
                    <span class="brand-subtitle">LOCAL AGENT</span>
                </div>
            </div>
            <div class="hud-status-pill" id="hud-status-pill" title="وضعیت اتصال هرمس / Hermes CLI Status">
                <span class="pulse-dot"></span>
                <span class="status-label" id="hud-status-text">Local CLI</span>
            </div>
            <nav class="nav-tabs">
                <button class="nav-tab active" data-tab="chat" title="گفتگو / Chat">
                    <span class="nav-icon">💬</span>
                    <span class="nav-text">چت</span>
                </button>
                <button class="nav-tab" data-tab="sessions" title="تاریخچه گفتگوها / Sessions">
                    <span class="nav-icon">🕒</span>
                    <span class="nav-badge" id="nav-sessions-count">0</span>
                </button>
                <button class="nav-tab" data-tab="skills" title="مهارت‌ها / Skills">
                    <span class="nav-icon">⚡</span>
                    <span class="nav-badge" id="nav-skills-count">0</span>
                </button>
                <button class="nav-tab" data-tab="models" title="مدل‌ها و تنظیمات / Models & Settings">
                    <span class="nav-icon">⚙️</span>
                </button>
            </nav>
        </header>

        <!-- Tab 1: Chat Panel (Figma Design) -->
        <main id="tab-chat" class="tab-panel active">
            <!-- Disconnected Alert Banner (Image 4) -->
            <div id="cli-disconnected-banner" class="cli-alert-banner" style="display: none;">
                <div class="alert-content">
                    <div class="alert-info">
                        <h4 class="alert-title">اتصال محلی برقرار نیست</h4>
                        <p class="alert-desc">برای شروع، راه‌اندازی هرمس را اجرا کنید.</p>
                    </div>
                    <div class="alert-actions">
                        <code class="alert-code">hermes setup</code>
                        <button id="btn-banner-run-setup" class="btn-banner-action">اجرای راه‌اندازی</button>
                    </div>
                </div>
            </div>

            <!-- Messages Container (Hero Astrolabe or Chat Timeline) -->
            <div id="messages-container" class="messages-container"></div>

            <!-- Command Mode Quick Palette (Image 4, triggers on /) -->
            <div id="command-mode-popup" class="command-palette-popup" style="display: none;">
                <div class="popup-header">
                    <span class="popup-title">دستورات سریع</span>
                    <span class="popup-close-hint">بستن ESC</span>
                </div>
                <div class="popup-items" id="popup-command-items">
                    <div class="popup-item active" data-cmd="/new">
                        <span class="cmd-name">/new</span>
                        <span class="cmd-desc">شروع گفت‌وگوی تازه (New Session)</span>
                        <span class="cmd-key">↵</span>
                    </div>
                    <div class="popup-item" data-cmd="/model">
                        <span class="cmd-name">/model</span>
                        <span class="cmd-desc">انتخاب مدل و پرووایدر هوش مصنوعی</span>
                        <span class="cmd-num">02</span>
                    </div>
                    <div class="popup-item" data-cmd="/skills">
                        <span class="cmd-name">/skills</span>
                        <span class="cmd-desc">مشاهده و اجرای مهارت‌های هرمس</span>
                        <span class="cmd-num">03</span>
                    </div>
                    <div class="popup-item" data-cmd="/history">
                        <span class="cmd-name">/history</span>
                        <span class="cmd-desc">تاریخچه سشن‌ها و گفتگوها</span>
                        <span class="cmd-num">04</span>
                    </div>
                    <div class="popup-item" data-cmd="/clear">
                        <span class="cmd-name">/clear</span>
                        <span class="cmd-desc">پاک‌کردن صفحه گفت‌وگو</span>
                        <span class="cmd-num">05</span>
                    </div>
                    <div class="popup-item" data-cmd="/retry">
                        <span class="cmd-name">/retry</span>
                        <span class="cmd-desc">ارسال مجدد آخرین پیام</span>
                        <span class="cmd-num">06</span>
                    </div>
                    <div class="popup-item" data-cmd="/setup">
                        <span class="cmd-name">/setup</span>
                        <span class="cmd-desc">راه‌اندازی اتصال محلی (hermes setup)</span>
                        <span class="cmd-num">07</span>
                    </div>
                </div>
            </div>

            <!-- In-Capsule Quick Model Dropdown Popover -->
            <div id="model-quick-popover" class="model-quick-popover" style="display: none;">
                <div class="popover-header">
                    <span>مدل‌های در دسترس</span>
                    <button type="button" class="popover-close-btn" id="btn-close-model-popover">✕</button>
                </div>
                <div class="popover-model-list" id="popover-model-list"></div>
                <div class="popover-footer">
                    <button type="button" id="btn-open-full-models-tab" class="btn-popover-more">⚙️ تنظیمات کامل پرووایدر و API Key</button>
                </div>
            </div>

            <!-- The Integrated Command Capsule (Image 2, 3, 4) -->
            <div id="command-capsule-wrapper" class="command-capsule-wrapper">
                <div class="command-capsule" id="command-capsule">
                    <div class="capsule-input-row">
                        <button type="button" class="capsule-slash-tag" id="btn-trigger-slash" title="دستورات سریع (کلید /)">/</button>
                        <textarea id="prompt-input" rows="1" placeholder="از هرمس بخواهید؛ بقیه‌اش با من."></textarea>
                        <span class="capsule-hint" id="capsule-hint">دستور سریع با /</span>
                    </div>
                    <div class="capsule-controls-row">
                        <div class="capsule-left-tools">
                            <button type="button" class="capsule-model-pill" id="capsule-model-pill" title="تغییر سریع مدل هوش مصنوعی">
                                <span class="model-pill-icon">⚙️</span>
                                <span class="model-pill-name" id="capsule-model-name">nemotron-3-ultra</span>
                                <span class="model-pill-arrow">▾</span>
                            </button>
                            <button type="button" class="capsule-tool-btn" id="btn-capsule-new" title="شروع گفتگوی جدید (New Chat)">＋</button>
                            <button type="button" class="capsule-tool-btn" id="btn-capsule-clear" title="پاک‌کردن سابقه گفتگو (Clear)">🧹</button>
                        </div>
                        <div class="capsule-right-tools">
                            <span class="capsule-timer" id="capsule-timer" style="display: none;">00:00</span>
                            <span class="capsule-enter-hint">Enter ↵</span>
                            <button type="button" class="capsule-action-btn" id="btn-capsule-action" title="ارسال پیام (Enter)">
                                <span class="action-icon" id="capsule-action-icon">↑</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Global Bottom Status Bar -->
                <footer class="capsule-footer-bar">
                    <span class="footer-left" id="footer-left-status">HERMES / v0.8</span>
                    <span class="footer-center">محلی. مستقل. تحت کنترل شما.</span>
                    <span class="footer-right" id="footer-right-status">
                        <span class="footer-dot"></span>
                        <span id="footer-right-text">CLI connected</span>
                    </span>
                </footer>
            </div>
        </main>

        <!-- Tab 2: Sessions Panel -->
        <main id="tab-sessions" class="tab-panel">
            <div class="panel-header">
                <div class="panel-title-row">
                    <h3>Past Conversations</h3>
                    <div class="panel-actions">
                        <button id="btn-sessions-new" class="btn-sm">＋ New</button>
                        <button id="btn-sessions-refresh" class="btn-sm">↻ Refresh</button>
                    </div>
                </div>
                <div class="filter-pills-row" id="sessions-filter-pills">
                    <button class="filter-pill active" data-filter="active">💬 Active (<span id="sessions-count-active">0</span>)</button>
                    <button class="filter-pill" data-filter="archived">📦 Archived (<span id="sessions-count-archived">0</span>)</button>
                    <button class="filter-pill" data-filter="all">All (<span id="sessions-count-all">0</span>)</button>
                </div>
                <input type="text" id="sessions-search" class="search-input" placeholder="Search sessions by title or model...">
            </div>
            <div id="sessions-list" class="cards-list"></div>
        </main>

        <!-- Tab 3: Skills Panel -->
        <main id="tab-skills" class="tab-panel">
            <div class="panel-header">
                <div class="panel-title-row">
                    <h3>Hermes Skills</h3>
                    <button id="btn-skills-refresh" class="btn-sm">↻ Refresh</button>
                </div>
                <p class="panel-desc">Skills loaded from <code>~/.hermes/skills</code>. Includes skills learned autonomously by Hermes.</p>
                <input type="text" id="skills-search" class="search-input" placeholder="Search skills by name or category...">
            </div>
            <div id="skills-list" class="cards-list"></div>
        </main>

        <!-- Tab 4: Models & Providers Panel -->
        <main id="tab-models" class="tab-panel">
            <div class="panel-header">
                <h3>Models & Inference Operators</h3>
                <p class="panel-desc">Configure your LLM operator, API keys, and active model graphically without editing YAML or using the terminal.</p>
            </div>

            <!-- Active Model Card -->
            <div class="active-model-card">
                <div class="card-tag">Active Model</div>
                <div class="active-model-title" id="active-model-name">Loading model...</div>
                <div class="active-model-provider" id="active-provider-name">Operator: OpenRouter</div>
                <div class="active-model-status" id="active-model-status">✓ Ready</div>
            </div>

            <!-- Configuration Form -->
            <div class="config-form-card">
                <h4>Switch Operator & Model</h4>

                <!-- Step 1: Provider / Operator -->
                <div class="form-group">
                    <label for="select-provider">1. Operator / Provider (اپراتور / پرووایدر):</label>
                    <select id="select-provider" class="form-select"></select>
                </div>

                <!-- Step 2: API Key -->
                <div class="form-group" id="group-api-key">
                    <div class="label-row">
                        <label for="input-api-key">2. API Key (کلید API):</label>
                        <span id="key-status-indicator" class="key-status-tag">Checking...</span>
                    </div>
                    <div class="input-with-button">
                        <input type="password" id="input-api-key" class="form-input" placeholder="Enter API Key">
                        <button type="button" id="btn-toggle-key-visibility" class="btn-toggle" title="Show/Hide Key">👁️</button>
                    </div>
                    <span class="form-help" id="key-help-text">Saved locally to <code>%LOCALAPPDATA%\\hermes\\.env</code></span>
                </div>

                <!-- Base URL (for custom or local) -->
                <div class="form-group" id="group-base-url" style="display: none;">
                    <label for="input-base-url">API Base URL (Optional):</label>
                    <input type="text" id="input-base-url" class="form-input" placeholder="https://api.example.com/v1">
                </div>

                <!-- Step 3: Model Selection -->
                <div class="form-group">
                    <div class="label-row">
                        <label for="select-model">3. Model (انتخاب مدل):</label>
                        <span class="model-count-label" id="model-count-label"></span>
                    </div>

                    <div class="filter-chips" id="model-filter-chips">
                        <button class="chip active" data-filter="all">All</button>
                        <button class="chip" data-filter="free">Free Tier</button>
                        <button class="chip" data-filter="top">Top Rated</button>
                        <button class="chip" data-filter="fast">Fast</button>
                    </div>

                    <select id="select-model" class="form-select"></select>

                    <div class="custom-model-toggle">
                        <label class="checkbox-label">
                            <input type="checkbox" id="check-custom-model"> Enter custom model ID manually
                        </label>
                        <input type="text" id="input-custom-model" class="form-input" placeholder="e.g. nvidia/nemotron-3-ultra-550b-a55b:free" style="display: none; margin-top: 6px;">
                    </div>
                </div>

                <!-- Action Button -->
                <div class="form-actions">
                    <button type="button" id="btn-save-model-config" class="btn-primary">
                        <span class="btn-icon">🚀</span>
                        <span id="btn-save-text">Apply & Start New Chat</span>
                    </button>
                </div>
                <div id="model-save-feedback" class="feedback-msg"></div>

                <!-- Integrated Settings & Agent Recovery Section -->
                <div class="settings-card obsidian-card" style="margin-top: 24px;">
                    <div class="card-section-header">
                        <span class="section-icon">⚙️</span>
                        <div class="section-title-wrap">
                            <span class="section-title">تنظیمات سیستم و بازیابی هرمس (Agent Settings & Recovery)</span>
                            <span class="section-desc">ابزارهای اتصال مجدد با Agent، اجرای تنظیمات ترمینال، مجوزهای خودکار و مسیرها</span>
                        </div>
                    </div>

                    <div class="setting-actions-grid" style="margin-top: 10px;">
                        <button type="button" id="btn-reconnect-hermes" class="btn-setting-action" title="اتصال مجدد ارتباط کلاینت با سرور لوکال هرمس">
                            <span class="btn-icon">↻</span>
                            <div class="btn-text-wrap">
                                <span class="btn-main-label">اتصال مجدد / Reconnect Hermes ACP</span>
                                <span class="btn-sub-label">بازیابی سریع ارتباط کلاینت با ایجنت در صورت قطعی</span>
                            </div>
                        </button>
                        <button type="button" id="btn-run-setup-terminal" class="btn-setting-action" title="اجرای مستقیم دستور هرمس ستاپ در ترمینال وی‌اس‌کد">
                            <span class="btn-icon">⚙️</span>
                            <div class="btn-text-wrap">
                                <span class="btn-main-label">اجرای 'hermes setup' در ترمینال</span>
                                <span class="btn-sub-label">پیکربندی کلیدها و مدل‌های هسته هرمس در ترمینال</span>
                            </div>
                        </button>
                    </div>

                    <div class="setting-row" style="margin-top: 12px; border-top: 1px solid rgba(229, 184, 106, 0.12); padding-top: 12px;">
                        <div class="setting-info">
                            <span class="setting-name">تأیید خودکار ابزارها (Auto-Approve Tool Permissions)</span>
                            <span class="setting-desc">اجرای مستقیم دستورات و ویرایش فایل‌ها بدون نیاز به تأیید دستی برای هر مرحله.</span>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="setting-auto-approve">
                            <span class="slider round"></span>
                        </label>
                    </div>

                    <div class="env-info-list" style="margin-top: 8px;">
                        <div class="env-info-item">
                            <span class="env-info-key">Working Directory (CWD):</span>
                            <code class="env-info-val" id="setting-cwd-label">Workspace Root</code>
                        </div>
                        <div class="env-info-item">
                            <span class="env-info-key">Hermes Config File:</span>
                            <code class="env-info-val">%LOCALAPPDATA%\hermes\config.yaml</code>
                        </div>
                    </div>
                </div>
            </div>
        </main>

        <!-- Confirmation Modal -->
        <div id="hermes-modal" class="modal-overlay" style="display: none;">
            <div class="modal-card">
                <div class="modal-header">
                    <span id="modal-icon" class="modal-icon">📦</span>
                    <h4 id="modal-title" class="modal-title">تأیید عملیات</h4>
                </div>
                <div class="modal-body">
                    <p id="modal-message" class="modal-message"></p>
                    <div id="modal-callout" class="modal-callout"></div>
                </div>
                <div class="modal-footer">
                    <button id="modal-btn-cancel" class="btn-sm btn-modal-cancel">انصراف / Cancel</button>
                    <button id="modal-btn-confirm" class="btn-sm btn-modal-confirm">تأیید</button>
                </div>
            </div>
        </div>

        <!-- Floating Toast Notification -->
        <div id="hermes-toast" class="toast-notification" style="display: none;"></div>
    </div>
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
