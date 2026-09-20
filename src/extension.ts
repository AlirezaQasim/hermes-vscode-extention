import * as vscode from 'vscode';
import { HermesACPClient } from './acp/client';
import { ChatViewProvider } from './ui/chatView';
import { SessionsViewProvider } from './ui/sessionsView';
import { SkillsViewProvider } from './ui/skillsView';
import { ToolsViewProvider } from './ui/toolsView';
import { StatusBarManager } from './ui/statusBar';
import { ConfigManager } from './config/manager';
import { SessionManager } from './handlers/sessionManager';
import { PermissionHandler } from './handlers/permissionHandler';
import { FileSystemHandler } from './handlers/fileSystemHandler';
import { TerminalHandler } from './handlers/terminalHandler';
import { Logger } from './utils/logger';

export interface ExtensionContext {
    client: HermesACPClient | null;
    chatProvider: ChatViewProvider;
    sessionsProvider: SessionsViewProvider;
    skillsProvider: SkillsViewProvider;
    toolsProvider: ToolsViewProvider;
    statusBar: StatusBarManager;
    config: ConfigManager;
    sessionManager: SessionManager;
    permissionHandler: PermissionHandler;
    fileSystemHandler: FileSystemHandler;
    terminalHandler: TerminalHandler;
    logger: Logger;
    isConnected: boolean;
    currentSessionId: string | null;
}

let extensionContext: ExtensionContext | null = null;

export function getExtensionContext(): ExtensionContext | null {
    return extensionContext;
}

export function setExtensionContext(context: ExtensionContext): void {
    extensionContext = context;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const logger = new Logger('HermesExtension');
    logger.info('Activating Hermes Agent extension');

    const config = new ConfigManager(context);
    const statusBar = new StatusBarManager();
    const sessionManager = new SessionManager(logger);
    const permissionHandler = new PermissionHandler(logger);
    const fileSystemHandler = new FileSystemHandler(logger);
    const terminalHandler = new TerminalHandler(logger);

    const chatProvider = new ChatViewProvider(context, logger);
    const sessionsProvider = new SessionsViewProvider(context, logger);
    const skillsProvider = new SkillsViewProvider(context, logger);
    const toolsProvider = new ToolsViewProvider(context, logger);

    vscode.window.registerWebviewViewProvider('hermes.chat', chatProvider);
    vscode.window.registerTreeDataProvider('hermes.sessions', sessionsProvider);
    vscode.window.registerTreeDataProvider('hermes.skills', skillsProvider);
    vscode.window.registerTreeDataProvider('hermes.tools', toolsProvider);

    extensionContext = {
        client: null,
        chatProvider,
        sessionsProvider,
        skillsProvider,
        toolsProvider,
        statusBar,
        config,
        sessionManager,
        permissionHandler,
        fileSystemHandler,
        terminalHandler,
        logger,
        isConnected: false,
        currentSessionId: null
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('hermes.connect', async () => {
            await connectToHermes();
        }),
        vscode.commands.registerCommand('hermes.disconnect', async () => {
            await disconnectFromHermes();
        }),
        vscode.commands.registerCommand('hermes.newSession', async () => {
            await createNewSession();
        }),
        vscode.commands.registerCommand('hermes.openChat', () => {
            vscode.commands.executeCommand('hermes.chat.focus');
        }),
        vscode.commands.registerCommand('hermes.sendPrompt', async () => {
            await sendPrompt();
        }),
        vscode.commands.registerCommand('hermes.cancelTurn', async () => {
            await cancelCurrentTurn();
        }),
        vscode.commands.registerCommand('hermes.switchModel', async () => {
            await switchModel();
        }),
        vscode.commands.registerCommand('hermes.switchProvider', async () => {
            await switchProvider();
        }),
        vscode.commands.registerCommand('hermes.toggleAutoApprove', async () => {
            await toggleAutoApprove();
        }),
        vscode.commands.registerCommand('hermes.showTokenUsage', async () => {
            await showTokenUsage();
        }),
        vscode.commands.registerCommand('hermes.pickSkill', async () => {
            await pickSkills();
        }),
        vscode.commands.registerCommand('hermes.refreshSessions', async () => {
            await refreshSessions();
        }),
        vscode.commands.registerCommand('hermes.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'hermes');
        }),
        vscode.commands.registerCommand('hermes.runSetup', async () => {
            await runHermesSetup();
        }),
        vscode.commands.registerCommand('hermes.checkACP', async () => {
            await checkACPDependencies();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('hermes')) {
                config.reload();
                if (extensionContext?.isConnected) {
                    await reconnectIfNeeded();
                }
            }
        })
    );

    if (config.get('enabled', true)) {
        await connectToHermes();
    }

    logger.info('Hermes Agent extension activated');
}

export async function deactivate(): Promise<void> {
    if (extensionContext?.client) {
        await disconnectFromHermes();
    }
    extensionContext?.logger.info('Hermes Agent extension deactivated');
}

async function connectToHermes(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    try {
        ctx.logger.info('Connecting to Hermes ACP server...');
        ctx.statusBar.setConnecting();

        const client = new HermesACPClient({
            command: ctx.config.get('acpCommand', 'hermes'),
            args: ctx.config.get('acpArgs', ['acp']),
            cwd: ctx.config.get('cwd', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()),
            env: process.env,
            logLevel: ctx.config.get('logLevel', 'info')
        });

        client.on('connected', () => {
            ctx.isConnected = true;
            ctx.currentSessionId = null;
            ctx.statusBar.setConnected();
            ctx.chatProvider.setConnected(true);
            ctx.sessionsProvider.refresh();
            vscode.commands.executeCommand('setContext', 'hermes.isConnected', true);
            ctx.logger.info('Connected to Hermes ACP server');
        });

        client.on('disconnected', (reason: string) => {
            ctx.isConnected = false;
            ctx.currentSessionId = null;
            ctx.statusBar.setDisconnected(reason);
            ctx.chatProvider.setConnected(false);
            vscode.commands.executeCommand('setContext', 'hermes.isConnected', false);
            ctx.logger.warn('Disconnected from Hermes ACP server', reason);
        });

        client.on('sessionUpdate', (update) => {
            handleSessionUpdate(update);
        });

        client.on('permissionRequest', (request) => {
            ctx.permissionHandler.handleRequest(request);
        });

        client.on('toolCall', (toolCall) => {
            handleToolCall(toolCall);
        });

        client.on('message', (message) => {
            ctx.chatProvider.addMessage(message);
        });

        client.on('tokenUsage', (usage) => {
            ctx.statusBar.updateTokenUsage(usage);
            if (ctx.config.get('showTokenUsage', true)) {
                ctx.chatProvider.updateTokenUsage(usage);
            }
        });

        client.on('error', (error) => {
            ctx.logger.error('ACP client error', error);
            vscode.window.showErrorMessage(`Hermes ACP error: ${error.message}`);
        });

        await client.connect();
        ctx.client = client;

        await createNewSession();

    } catch (error) {
        ctx.logger.error('Failed to connect to Hermes', error);
        ctx.statusBar.setError(String(error));
        vscode.window.showErrorMessage(`Failed to connect to Hermes: ${error}`);
    }
}

async function disconnectFromHermes(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.client) return;

    try {
        await ctx.client.disconnect();
        ctx.client = null;
        ctx.isConnected = false;
        ctx.currentSessionId = null;
        ctx.statusBar.setDisconnected('Disconnected by user');
        ctx.chatProvider.setConnected(false);
        vscode.commands.executeCommand('setContext', 'hermes.isConnected', false);
        ctx.logger.info('Disconnected from Hermes ACP server');
    } catch (error) {
        ctx.logger.error('Error disconnecting from Hermes', error);
    }
}

async function createNewSession(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.client) return;

    try {
        const cwd = ctx.config.get('cwd', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
        const session = await ctx.client.createSession(cwd);
        ctx.currentSessionId = session.sessionId;
        ctx.sessionManager.setCurrentSession(session.sessionId);
        ctx.chatProvider.setSession(session.sessionId);
        ctx.sessionsProvider.refresh();
        ctx.statusBar.setSession(session.sessionId);
        ctx.logger.info('Created new session', session.sessionId);
    } catch (error) {
        ctx.logger.error('Failed to create session', error);
        vscode.window.showErrorMessage(`Failed to create session: ${error}`);
    }
}

async function sendPrompt(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.client || !ctx.currentSessionId) {
        vscode.window.showWarningMessage('Not connected to Hermes');
        return;
    }

    const prompt = await vscode.window.showInputBox({
        prompt: 'Enter your prompt for Hermes',
        placeHolder: 'Type your message...'
    });

    if (prompt) {
        await ctx.client.sendPrompt(ctx.currentSessionId, prompt);
    }
}

async function cancelCurrentTurn(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.client || !ctx.currentSessionId) return;

    try {
        await ctx.client.cancelTurn(ctx.currentSessionId);
        ctx.logger.info('Cancelled current turn');
    } catch (error) {
        ctx.logger.error('Failed to cancel turn', error);
    }
}

async function switchModel(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.client || !ctx.currentSessionId) return;

    const models = await ctx.client.getAvailableModels(ctx.currentSessionId);
    if (!models || models.length === 0) {
        vscode.window.showInformationMessage('No models available');
        return;
    }

    const selected = await vscode.window.showQuickPick(models.map(m => ({
        label: m.name,
        description: m.provider,
        detail: m.description,
        model: m
    })), {
        placeHolder: 'Select a model'
    });

    if (selected) {
        await ctx.client.setModel(ctx.currentSessionId, selected.model.id);
        ctx.logger.info('Switched model', selected.model.id);
    }
}

async function switchProvider(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.client || !ctx.currentSessionId) return;

    const providers = await ctx.client.getAvailableProviders(ctx.currentSessionId);
    if (!providers || providers.length === 0) {
        vscode.window.showInformationMessage('No providers available');
        return;
    }

    const selected = await vscode.window.showQuickPick(providers.map(p => ({
        label: p.name,
        description: p.description,
        provider: p
    })), {
        placeHolder: 'Select a provider'
    });

    if (selected) {
        await ctx.client.setProvider(ctx.currentSessionId, selected.provider.id);
        ctx.logger.info('Switched provider', selected.provider.id);
    }
}

async function toggleAutoApprove(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    const newValue = !ctx.config.get('autoApprovePermissions', false);
    await ctx.config.update('autoApprovePermissions', newValue);
    ctx.permissionHandler.setAutoApprove(newValue);
    ctx.statusBar.setAutoApprove(newValue);
    vscode.window.showInformationMessage(`Auto-approve ${newValue ? 'enabled' : 'disabled'}`);
}

async function showTokenUsage(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.client || !ctx.currentSessionId) return;

    const usage = await ctx.client.getTokenUsage(ctx.currentSessionId);
    if (usage) {
        vscode.window.showInformationMessage(
            `Tokens: ${usage.promptTokens} prompt + ${usage.completionTokens} completion = ${usage.totalTokens} total`
        );
    }
}

async function pickSkills(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    const skillsPath = ctx.config.get('skillsPath', '~/.hermes/skills');
    const skills = await ctx.skillsProvider.loadSkills(skillsPath);

    const selected = await vscode.window.showQuickPick(skills.map(s => ({
        label: s.name,
        description: s.description,
        detail: s.path,
        skill: s
    })), {
        placeHolder: 'Select skills to inject (multi-select)',
        canPickMany: true
    });

    if (selected && selected.length > 0) {
        await ctx.client?.injectSkills(ctx.currentSessionId!, selected.map(s => s.skill.name));
        ctx.logger.info('Injected skills', selected.map(s => s.skill.name));
    }
}

async function refreshSessions(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.client) return;

    try {
        const sessions = await ctx.client.listSessions();
        ctx.sessionsProvider.setSessions(sessions);
        ctx.sessionsProvider.refresh();
    } catch (error) {
        ctx.logger.error('Failed to refresh sessions', error);
    }
}

async function runHermesSetup(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    const cwd: string = ctx.config.get('cwd', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
    const terminal = vscode.window.createTerminal({
        name: 'Hermes Setup',
        cwd
    });
    terminal.show();
    terminal.sendText('hermes setup');
}

async function checkACPDependencies(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    const cwd: string = ctx.config.get('cwd', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
    const terminal = vscode.window.createTerminal({
        name: 'Hermes ACP Check',
        cwd
    });
    terminal.show();
    terminal.sendText('hermes acp --check');
}

async function reconnectIfNeeded(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx || !ctx.isConnected) return;

    await disconnectFromHermes();
    await connectToHermes();
}

function handleSessionUpdate(update: any): void {
    const ctx = getExtensionContext();
    if (!ctx) return;

    switch (update.kind) {
        case 'agent_message_chunk':
            ctx.chatProvider.addAgentChunk(update.content);
            break;
        case 'user_message_chunk':
            ctx.chatProvider.addUserChunk(update.content);
            break;
        case 'thought_chunk':
            ctx.chatProvider.addThoughtChunk(update.content);
            break;
        case 'tool_call':
            ctx.chatProvider.addToolCall(update);
            break;
        case 'tool_call_update':
            ctx.chatProvider.updateToolCall(update);
            break;
        case 'plan':
            ctx.chatProvider.addPlan(update.content);
            break;
        case 'available_commands_update':
            ctx.chatProvider.updateCommands(update.commands);
            break;
        case 'mode_change':
            ctx.statusBar.setMode(update.mode);
            break;
    }
}

function handleToolCall(toolCall: any): void {
    const ctx = getExtensionContext();
    if (!ctx) return;

    ctx.chatProvider.addToolCall(toolCall);

    switch (toolCall.kind) {
        case 'read':
        case 'edit':
        case 'write':
        case 'delete':
            ctx.fileSystemHandler.handleToolCall(toolCall);
            break;
        case 'execute':
        case 'bash':
            ctx.terminalHandler.handleToolCall(toolCall);
            break;
    }
}