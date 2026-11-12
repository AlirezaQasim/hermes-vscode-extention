import * as vscode from 'vscode';
import { HermesACPClient } from './acp/client';
import { ChatViewProvider } from './ui/chatView';
import { SessionsViewProvider } from './ui/sessionsView';
import { SkillsViewProvider } from './ui/skillsView';
import { ToolsViewProvider } from './ui/toolsView';
import { SetupViewProvider } from './ui/setupView';
import { ConfigViewProvider, ConnectionsViewProvider } from './ui/configView';
import { StatusBarManager } from './ui/statusBar';
import { ConfigManager } from './config/manager';
import { SessionManager } from './handlers/sessionManager';
import { PermissionHandler } from './handlers/permissionHandler';
import { FileSystemHandler } from './handlers/fileSystemHandler';
import { TerminalHandler } from './handlers/terminalHandler';
import { Logger } from './utils/logger';
import { getHermesSafeCwd } from './utils/hermesPaths';
import { ConfigService, SessionService, SkillService } from './services';
import * as fs from 'fs';
import * as path from 'path';

export interface ExtensionContext {
    client: HermesACPClient | null;
    chatProvider: ChatViewProvider;
    sessionsProvider: SessionsViewProvider;
    skillsProvider: SkillsViewProvider;
    toolsProvider: ToolsViewProvider;
    setupProvider: SetupViewProvider;
    configProvider: ConfigViewProvider;
    connectionsProvider: ConnectionsViewProvider;
    statusBar: StatusBarManager;
    config: ConfigManager;
    sessionManager: SessionManager;
    permissionHandler: PermissionHandler;
    fileSystemHandler: FileSystemHandler;
    terminalHandler: TerminalHandler;
    configService: ConfigService;
    sessionService: SessionService;
    skillService: SkillService;
    logger: Logger;
    isConnected: boolean;
    currentSessionId: string | null;
    chatParticipantStream: vscode.ChatResponseStream | null;
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

    const configService = new ConfigService(logger);
    const sessionService = new SessionService(logger);
    const skillService = new SkillService(logger);

    const chatProvider = new ChatViewProvider(
        context,
        logger,
        () => extensionContext,
        configService,
        sessionService,
        skillService
    );
    const sessionsProvider = new SessionsViewProvider(context, logger);
    const skillsProvider = new SkillsViewProvider(context, logger);
    const toolsProvider = new ToolsViewProvider(context, logger);
    const setupProvider = new SetupViewProvider(context, logger);
    const configProvider = new ConfigViewProvider(logger);
    const connectionsProvider = new ConnectionsViewProvider(logger);

    vscode.window.registerWebviewViewProvider('hermes.chat', chatProvider);
    vscode.window.registerTreeDataProvider('hermes.sessions', sessionsProvider);
    vscode.window.registerTreeDataProvider('hermes.skills', skillsProvider);
    vscode.window.registerTreeDataProvider('hermes.tools', toolsProvider);
    vscode.window.registerWebviewViewProvider('hermes.setup', setupProvider);
    vscode.window.registerTreeDataProvider('hermes.config', configProvider);
    vscode.window.registerTreeDataProvider('hermes.connections', connectionsProvider);

    extensionContext = {
        client: null,
        chatProvider,
        sessionsProvider,
        skillsProvider,
        toolsProvider,
        setupProvider,
        configProvider,
        connectionsProvider,
        statusBar,
        config,
        sessionManager,
        permissionHandler,
        fileSystemHandler,
        terminalHandler,
        configService,
        sessionService,
        skillService,
        logger,
        isConnected: false,
        currentSessionId: null,
        chatParticipantStream: null
    };
    (global as any).hermesExtensionContext = extensionContext;

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
        }),
        vscode.commands.registerCommand('hermes.loadSession', async (sessionId: string) => {
            await loadSession(sessionId);
        }),
        vscode.commands.registerCommand('hermes.openSkillFile', async (skillPath: string) => {
            await openSkillFile(skillPath);
        }),
        vscode.commands.registerCommand('hermes.injectSkill', async (skillName: string) => {
            await injectSkill(skillName);
        }),
        vscode.commands.registerCommand('hermes.refreshSkills', async () => {
            await refreshSkills();
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

    // Initialize session manager safely
    sessionManager.initialize().catch(err => logger.warn('Session manager init warning:', err));

    // Register chat participant
    registerChatParticipant(context).catch(err => logger.warn('Chat participant registration warning:', err));

    // Auto-connect in background if enabled
    if (config.get('enabled', true)) {
        connectToHermes().catch(err => logger.warn('Auto-connect warning:', err));
    }

    logger.info('Hermes Agent extension activated');
}

export async function deactivate(): Promise<void> {
    if (extensionContext?.client) {
        await disconnectFromHermes();
    }
    extensionContext?.configService.dispose();
    extensionContext?.sessionService.dispose();
    extensionContext?.logger.info('Hermes Agent extension deactivated');
}

async function connectToHermes(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    try {
        ctx.logger.info('Connecting to Hermes ACP server...');
        ctx.statusBar.setConnecting();
        ctx.chatProvider.setConnecting();

        const acpCommand = ctx.config.get('acpCommand', 'hermes');
        const acpArgs = ctx.config.get('acpArgs', ['acp']);
        const configuredCwd = ctx.config.get('cwd', '${workspaceFolder}');
        const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const cwd = getHermesSafeCwd(configuredCwd, workspaceCwd);
        
        ctx.logger.info(`ACP Config: command="${acpCommand}", args=[${acpArgs.join(', ')}], cwd="${cwd}"`);

        const client = new HermesACPClient({
            command: acpCommand,
            args: acpArgs,
            cwd,
            env: process.env,
            logLevel: ctx.config.get('logLevel', 'info')
        });

        client.on('connected', async () => {
            ctx.isConnected = true;
            ctx.statusBar.setConnected();
            ctx.chatProvider.setConnected(true);
            vscode.commands.executeCommand('setContext', 'hermes.isConnected', true);
            ctx.logger.info('Connected to Hermes ACP server');

            // Load existing sessions from Hermes database and attach to latest
            await loadExistingSessions();
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

    } catch (error) {
        ctx.logger.error('Failed to connect to Hermes', error);
        ctx.statusBar.setError(String(error));
        ctx.chatProvider.setConnected(false);
        vscode.window.showErrorMessage(`Failed to connect to Hermes: ${error}`);
    }
}

async function loadExistingSessions(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    try {
        const sessions = await ctx.sessionsProvider.loadSessions();
        if (sessions && sessions.length > 0) {
            ctx.logger.info(`Found ${sessions.length} existing Hermes sessions in database`);
            
            // Load sessions into session manager
            for (const session of sessions) {
                ctx.sessionManager.loadSessionFromACP({
                    id: session.sessionId,
                    title: session.title,
                    preview: session.title,
                    model: session.model,
                    cwd: session.cwd,
                    messageCount: session.historyLen,
                    createdAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
                    updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now()
                });
            }
            
            ctx.sessionsProvider.refresh();
            
            // Auto-load the most recent session
            const latestSession = sessions[0];
            if (latestSession && !ctx.currentSessionId) {
                await loadSession(latestSession.sessionId);
            }
        } else if (ctx.client) {
            ctx.logger.info('No existing Hermes sessions found, creating new one');
            await createNewSession();
        }
    } catch (error) {
        ctx.logger.error('Failed to load existing sessions', error);
        if (ctx.client && !ctx.currentSessionId) {
            await createNewSession();
        }
    }
}

async function loadSession(sessionId: string): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    try {
        ctx.logger.info(`Loading session: ${sessionId}`);
        ctx.statusBar.setConnecting();
        
        // Find session metadata if available
        const sessions = await ctx.sessionsProvider.loadSessions();
        const sessionMeta = sessions.find(s => s.sessionId === sessionId);
        const sessionTitle = sessionMeta?.title || sessionId.slice(0, 8);

        // Fetch past messages from DB directly for instant rendering via warm SessionService
        const dbMessages = await ctx.sessionService.getSessionMessages(sessionId);
        ctx.logger.info(`Loaded ${dbMessages.length} messages from DB for session ${sessionId}`);

        // Update chat provider with these messages
        ctx.currentSessionId = sessionId;
        ctx.sessionManager.setCurrentSession(sessionId);
        ctx.chatProvider.loadMessages(sessionId, dbMessages, sessionTitle);
        ctx.statusBar.setSession(sessionId);
        ctx.sessionsProvider.refresh();

        // Connect ACP to this session if client is connected
        if (ctx.client && ctx.isConnected) {
            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const configuredCwd = sessionMeta?.cwd || ctx.config.get('cwd', '${workspaceFolder}');
                const sessionCwd = getHermesSafeCwd(configuredCwd, workspaceFolder);
                await ctx.client.loadSession(sessionId, sessionCwd);
                ctx.logger.info(`ACP client attached to session ${sessionId}`);
            } catch (acpErr) {
                ctx.logger.warn(`ACP session/load warning for ${sessionId}:`, acpErr);
            }
        }
        ctx.statusBar.setConnected();
        vscode.commands.executeCommand('hermes.chat.focus');
    } catch (error) {
        ctx.logger.error('Failed to load session', error);
        vscode.window.showErrorMessage(`Failed to load session: ${error}`);
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
        ctx.chatParticipantStream = null;
        currentChatStream = null;
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

    const skills = await ctx.skillsProvider.loadSkills();

    const selected = await vscode.window.showQuickPick(skills.map(s => ({
        label: `${s.isLearned ? '🌟 ' : ''}${s.name}`,
        description: s.category ? `[${s.category}] ${s.description}` : s.description,
        detail: s.path,
        skill: s
    })), {
        placeHolder: 'Select skills to inject into current session (multi-select)',
        canPickMany: true
    });

    if (selected && selected.length > 0) {
        if (ctx.client && ctx.currentSessionId) {
            await ctx.client.injectSkills(ctx.currentSessionId, selected.map(s => s.skill.name));
            ctx.logger.info('Injected skills', selected.map(s => s.skill.name));
            vscode.window.showInformationMessage(`Injected ${selected.length} skill(s) into current session.`);
        } else {
            vscode.window.showWarningMessage('Please connect to Hermes and start a session first.');
        }
    }
}

async function openSkillFile(skillPath: string): Promise<void> {
    const ctx = getExtensionContext();
    if (!skillPath) {
        ctx?.logger.warn('No skillPath provided to openSkillFile');
        return;
    }

    try {
        if (!fs.existsSync(skillPath)) {
            vscode.window.showWarningMessage(`Skill file not found at: ${skillPath}`);
            return;
        }

        const doc = await vscode.workspace.openTextDocument(skillPath);
        await vscode.window.showTextDocument(doc, { preview: false });
        ctx?.logger.info(`Opened skill file: ${skillPath}`);
    } catch (error) {
        ctx?.logger.error('Failed to open skill file', error);
        vscode.window.showErrorMessage(`Failed to open skill file: ${error}`);
    }
}

async function injectSkill(skillName: string): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    if (!skillName) {
        await pickSkills();
        return;
    }

    try {
        if (ctx.client && ctx.currentSessionId) {
            await ctx.client.injectSkills(ctx.currentSessionId, [skillName]);
            vscode.window.showInformationMessage(`Skill '${skillName}' injected into current session.`);
        } else {
            vscode.window.showWarningMessage('Please connect to Hermes and start a session first.');
        }
    } catch (error) {
        ctx.logger.error(`Failed to inject skill ${skillName}`, error);
        vscode.window.showErrorMessage(`Failed to inject skill: ${error}`);
    }
}

async function refreshSessions(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    try {
        await ctx.sessionsProvider.loadSessions();
        vscode.window.showInformationMessage('Hermes sessions refreshed.');
    } catch (error) {
        ctx.logger.error('Failed to refresh sessions', error);
    }
}

async function refreshSkills(): Promise<void> {
    const ctx = getExtensionContext();
    if (!ctx) return;

    try {
        await ctx.skillsProvider.loadSkills();
        vscode.window.showInformationMessage('Hermes skills refreshed.');
    } catch (error) {
        ctx.logger.error('Failed to refresh skills', error);
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

    // Route to chat participant stream if active
    const chatStream = ctx.chatParticipantStream || currentChatStream;
    
    switch (update.kind) {
        case 'agent_message_chunk':
            ctx.chatProvider.addAgentChunk(update.content);
            if (chatStream) {
                chatStream.markdown(update.content);
            }
            break;
        case 'user_message_chunk':
            ctx.chatProvider.addUserChunk(update.content);
            break;
        case 'thought_chunk':
            ctx.chatProvider.addThoughtChunk(update.content);
            if (chatStream) {
                chatStream.markdown(`_Thinking: ${update.content}_`);
            }
            break;
        case 'tool_call':
            ctx.chatProvider.addToolCall(update);
            if (chatStream) {
                chatStream.markdown(`🔧 **Tool: ${update.name}**\n\`\`\`json\n${JSON.stringify(update.args, null, 2)}\n\`\`\``);
            }
            break;
        case 'tool_call_update':
            ctx.chatProvider.updateToolCall(update);
            if (chatStream && update.status === 'done') {
                chatStream.markdown(`✅ **Tool completed**${update.result ? `\n\`\`\`\n${update.result}\n\`\`\`` : ''}${update.error ? `\n❌ ${update.error}` : ''}`);
            }
            break;
        case 'plan':
            ctx.chatProvider.addPlan(update.content);
            if (chatStream) {
                chatStream.markdown(`📋 **Plan:**\n${update.content}`);
            }
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

// ============================================
// Chat Participant Implementation (Enterprise)
// ============================================

let hermesChatParticipant: vscode.ChatParticipant | null = null;
let currentChatStream: vscode.ChatResponseStream | null = null;

export function getHermesChatParticipant(): vscode.ChatParticipant | null {
    return hermesChatParticipant;
}

async function registerChatParticipant(context: vscode.ExtensionContext): Promise<void> {
    const logger = new Logger('HermesChatParticipant');
    
    hermesChatParticipant = vscode.chat.createChatParticipant('hermes.agent', async (request, _context, stream, token) => {
        const ctx = getExtensionContext();
        if (!ctx || !ctx.client) {
            stream.markdown('⚠️ **Not connected to Hermes**. Run "Hermes: Connect" first or open the Hermes panel.');
            return;
        }

        token.onCancellationRequested(async () => {
            if (ctx.client && ctx.currentSessionId) {
                await ctx.client.cancelTurn(ctx.currentSessionId);
            }
        });

        // Auto-create session if needed
        if (!ctx.currentSessionId) {
            stream.progress('Creating new Hermes session...');
            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const sessionCwd = getHermesSafeCwd(ctx.config.get('cwd', '${workspaceFolder}'), workspaceFolder);
                const session = await ctx.client.createSession(sessionCwd);
                ctx.currentSessionId = session.sessionId;
                ctx.chatProvider.setSession(session.sessionId);
                ctx.sessionsProvider.refresh();
                stream.markdown(`⚡ **Session:** \`${session.sessionId.slice(0, 8)}...\`\n\n`);
            } catch (error) {
                stream.markdown(`❌ **Failed to create session:** ${error}`);
                return;
            }
        }

        // Store stream reference for sessionUpdate routing
        currentChatStream = stream;
        ctx.chatParticipantStream = stream;

        try {
            // Handle slash commands
            if (request.command) {
                await handleChatCommand(request.command, request, ctx, stream, token);
                return;
            }

            // Send prompt to Hermes (await completes when the turn finishes)
            await ctx.client.sendPrompt(ctx.currentSessionId, request.prompt);
        } catch (error) {
            logger.error('Chat participant error', error);
            stream.markdown(`\n\n❌ **Error:** ${error}`);
        } finally {
            currentChatStream = null;
            if (ctx) {
                ctx.chatParticipantStream = null;
            }
        }
    });

    // Set participant properties
    hermesChatParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'hermes-icon.svg');
    
    logger.info('Hermes chat participant registered');
}

async function handleChatCommand(command: string, request: vscode.ChatRequest, ctx: any, stream: vscode.ChatResponseStream, _token: vscode.CancellationToken): Promise<void> {
    switch (command) {
        case 'new':
            await createNewSession();
            stream.markdown('✅ **New session created**');
            break;
        case 'model':
            await switchModel();
            stream.markdown('🔄 **Model switched**');
            break;
        case 'skills':
            await pickSkills();
            stream.markdown('🧠 **Skills updated**');
            break;
        case 'approve':
            await toggleAutoApprove();
            stream.markdown(`🛡️ **Auto-approve ${ctx.config.get('autoApprovePermissions') ? 'enabled' : 'disabled'}**`);
            break;
        default:
            stream.markdown(`Unknown command: /${command}`);
    }
}