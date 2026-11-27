import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import { Logger } from '../utils/logger';
import { getHermesHome, getHermesCliPath, getHermesSafeCwd } from '../utils/hermesPaths';

export interface ACPClientConfig {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    logLevel: string;
}

export interface ACPSession {
    sessionId: string;
    models?: any[];
    modes?: any;
    fieldMeta?: any;
}

export interface ACPMessage {
    jsonrpc: '2.0';
    id?: number | string;
    method?: string;
    params?: any;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export interface ACPInitializeResponse {
    protocolVersion: number;
    agentInfo: {
        name: string;
        version: string;
    };
    agentCapabilities: any;
    authMethods: any[];
}

export interface ACPNewSessionResponse {
    sessionId: string;
    models?: any[];
    modes?: any;
    fieldMeta?: any;
}

export interface ACPSendPromptParams {
    sessionId: string;
    prompt: any[];
}

export interface ACPSessionUpdate {
    sessionId: string;
    update: {
        kind: string;
        content?: any;
        toolCall?: any;
        plan?: any;
        commands?: any[];
        mode?: string;
    };
}

export interface ACPPermissionOption {
    optionId: string;
    kind: string;
    name: string;
}

export interface ACPPermissionRequest {
    id?: number | string;
    sessionId: string;
    requestId?: string;
    toolCall: any;
    options: ACPPermissionOption[] | string[];
}

export interface ACPToolCall {
    id: string;
    name: string;
    args: any;
    kind: string;
    title?: string;
}

export interface ACPTokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    maxContextTokens?: number;
    cachedTokens?: number;
    size?: number;
}

export class HermesACPClient extends EventEmitter {
    private process: ChildProcess | null = null;
    private config: ACPClientConfig;
    private logger: Logger;
    private messageId = 0;
    private pendingRequests = new Map<number | string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    private buffer = '';
    private isConnected = false;
    private currentSessionId: string | null = null;
    private isReplayingHistory = false;
    private suppressTurnEvents = false;
    private availableAcpModels: any[] = [];
    private currentAcpModelId = '';
    private availableAcpModes: any[] = [];
    private permissionRequestHandler: ((request: ACPPermissionRequest) => Promise<string>) | null = null;
    private autoApproveEnabled = false;

    constructor(config: ACPClientConfig) {
        super();
        this.config = config;
        this.logger = new Logger('HermesACPClient');
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const commandPath = getHermesCliPath(this.config.command);
                const hermesHome = getHermesHome();
                const safeCwd = getHermesSafeCwd(this.config.cwd);

                this.logger.info(`Starting Hermes ACP: command="${commandPath}", args=[${this.config.args.join(', ')}], cwd="${safeCwd}", HERMES_HOME="${hermesHome}"`);

                const env = {
                    ...process.env,
                    ...this.config.env,
                    HERMES_HOME: hermesHome,
                    PYTHONUNBUFFERED: '1',
                    PYTHONIOENCODING: 'utf-8'
                };

                const isWindows = process.platform === 'win32';
                const useShell = isWindows && (commandPath.toLowerCase().endsWith('.cmd') || commandPath.toLowerCase().endsWith('.bat'));

                this.process = spawn(commandPath, this.config.args, {
                    cwd: safeCwd,
                    env,
                    stdio: ['pipe', 'pipe', 'pipe'] as const,
                    windowsHide: true,
                    shell: useShell
                });

                if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
                    throw new Error('Failed to create stdio pipes for Hermes process');
                }

                this.process.stdout.on('data', (data: Buffer) => {
                    this.handleStdout(data.toString('utf8'));
                });

                this.process.stderr.on('data', (data: Buffer) => {
                    this.logger.debug(`ACP stderr: ${data.toString('utf8')}`);
                });

                this.process.on('error', (error) => {
                    this.logger.error('ACP process error', error);
                    if (!this.isConnected) {
                        reject(error);
                    } else {
                        this.emit('error', error);
                    }
                });

                this.process.on('exit', (code, signal) => {
                    this.logger.info(`ACP process exited: code=${code}, signal=${signal}`);
                    const wasConnected = this.isConnected;
                    this.isConnected = false;
                    this.process = null;
                    if (wasConnected) {
                        this.emit('disconnected', `Process exited (code: ${code}, signal: ${signal})`);
                    } else {
                        reject(new Error(`Hermes process exited before connection: code=${code}, signal=${signal}`));
                    }
                });

                // Send initialize request immediately over the established stdio stream
                const doInitialize = async () => {
                    try {
                        const initResponse = await this.sendRequest('initialize', {
                            protocolVersion: 1,
                            clientCapabilities: {
                                fs: {
                                    readTextFile: true,
                                    writeTextFile: true
                                },
                                terminal: true
                            },
                            clientInfo: {
                                name: 'vscode-hermes',
                                title: 'VS Code Hermes Extension',
                                version: '1.0.4'
                            }
                        }, 20000);

                        this.logger.debug('Initialize response', initResponse);
                        this.isConnected = true;
                        this.emit('connected');
                        resolve();
                    } catch (error) {
                        this.logger.error('Initialize failed', error);
                        this.cleanup();
                        reject(error);
                    }
                };

                // Queue microtask so process event handlers are ready
                setImmediate(doInitialize);

            } catch (error) {
                this.logger.error('Failed to spawn ACP process', error);
                reject(error);
            }
        });
    }

    async disconnect(): Promise<void> {
        for (const [, { reject }] of this.pendingRequests) {
            reject(new Error('Disconnected'));
        }
        this.pendingRequests.clear();

        if (this.process) {
            this.process.kill('SIGTERM');
            await new Promise<void>((resolve) => {
                if (!this.process) {
                    resolve();
                    return;
                }
                this.process.on('exit', () => resolve());
                setTimeout(() => {
                    if (this.process) {
                        this.process.kill('SIGKILL');
                    }
                    resolve();
                }, 2000);
            });
            this.process = null;
        }
        this.isConnected = false;
        this.currentSessionId = null;
        this.emit('disconnected', 'Disconnected by user');
    }

    private handleStdout(data: string): void {
        this.buffer += data;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
                try {
                    const message: ACPMessage = JSON.parse(trimmed);
                    this.handleMessage(message);
                } catch (error) {
                    this.logger.error('Failed to parse ACP message', error, trimmed);
                }
            }
        }
    }

    setAutoApprove(enabled: boolean): void {
        this.autoApproveEnabled = enabled;
        this.logger.info(`Auto-approve permissions: ${enabled}`);
    }

    setPermissionRequestHandler(handler: (request: ACPPermissionRequest) => Promise<string>): void {
        this.permissionRequestHandler = handler;
    }

    getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    sendResponse(id: number | string, result: any): void {
        if (!this.process || !this.process.stdin) {
            this.logger.error('Cannot send response: Hermes ACP is not connected');
            return;
        }

        const message = {
            jsonrpc: '2.0',
            id,
            result
        };

        const data = JSON.stringify(message) + '\n';
        this.process.stdin.write(data, (error) => {
            if (error) {
                this.logger.error('Failed to send response to Hermes ACP', error);
            }
        });
    }

    sendErrorResponse(id: number | string, code: number, messageText: string, data?: any): void {
        if (!this.process || !this.process.stdin) {
            return;
        }

        const message = {
            jsonrpc: '2.0',
            id,
            error: {
                code,
                message: messageText,
                data
            }
        };

        const str = JSON.stringify(message) + '\n';
        this.process.stdin.write(str);
    }

    private handleMessage(message: ACPMessage): void {
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id)!;
            this.pendingRequests.delete(message.id);

            if (message.error) {
                reject(new Error(`ACP Error ${message.error.code}: ${message.error.message}`));
            } else {
                resolve(message.result);
            }
        } else if (message.id !== undefined && message.method) {
            this.handleServerRequest(message.id, message.method, message.params);
        } else if (message.method) {
            this.handleNotification(message.method, message.params);
        }
    }

    private async handleServerRequest(id: number | string, method: string, params: any): Promise<void> {
        this.logger.info(`Received server request from Hermes: method=${method}, id=${id}`);

        switch (method) {
            case 'session/request_permission':
            case 'session/requestPermission':
            case 'permission/request': {
                try {
                    await this.handlePermissionServerRequest(id, params);
                } catch (error) {
                    this.logger.error('Failed to handle permission request', error);
                    this.sendResponse(id, {
                        outcome: {
                            outcome: 'cancelled'
                        }
                    });
                }
                break;
            }
            case 'fs/readTextFile':
            case 'fs/read_text_file': {
                try {
                    const filePath = params?.path || params?.filePath;
                    if (!filePath) {
                        this.sendErrorResponse(id, -32602, 'Path required');
                        return;
                    }
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    this.sendResponse(id, { content });
                } catch (error: any) {
                    this.sendErrorResponse(id, -32603, error.message || 'Failed to read file');
                }
                break;
            }
            case 'fs/writeTextFile':
            case 'fs/write_text_file': {
                try {
                    const filePath = params?.path || params?.filePath;
                    const content = params?.content || '';
                    if (!filePath) {
                        this.sendErrorResponse(id, -32602, 'Path required');
                        return;
                    }
                    await fs.promises.writeFile(filePath, content, 'utf8');
                    this.sendResponse(id, { success: true });
                } catch (error: any) {
                    this.sendErrorResponse(id, -32603, error.message || 'Failed to write file');
                }
                break;
            }
            default:
                this.logger.warn(`Unknown server request method: ${method}`);
                this.sendErrorResponse(id, -32601, `Method not found: ${method}`);
        }
    }

    private async handlePermissionServerRequest(id: number | string, params: any): Promise<void> {
        const rawOptions = params?.options || [];
        const normalizedOptions: ACPPermissionOption[] = rawOptions.map((opt: any) => {
            if (typeof opt === 'string') {
                return {
                    optionId: opt,
                    kind: opt,
                    name: opt.charAt(0).toUpperCase() + opt.slice(1).replace(/_/g, ' ')
                };
            }
            return {
                optionId: opt.optionId || opt.option_id || opt.id || 'allow_once',
                kind: opt.kind || opt.optionId || 'allow_once',
                name: opt.name || opt.title || (opt.optionId ? opt.optionId.replace(/_/g, ' ') : 'Allow')
            };
        });

        if (normalizedOptions.length === 0) {
            normalizedOptions.push(
                { optionId: 'allow_once', kind: 'allow_once', name: 'Allow edit' },
                { optionId: 'deny', kind: 'reject_once', name: 'Deny' }
            );
        }

        const toolCall = params?.toolCall || {};
        const toolName = toolCall.name || toolCall.title || toolCall.kind || 'tool';

        // 1. If autoApprove is active:
        if (this.autoApproveEnabled) {
            const allowOpt = normalizedOptions.find(o => 
                o.kind.startsWith('allow') || o.optionId.startsWith('allow') || o.optionId.includes('allow')
            ) || normalizedOptions[0];

            const chosenId = allowOpt ? allowOpt.optionId : 'allow_once';
            this.logger.info(`Auto-approving permission request (${toolName}) with option: ${chosenId}`);

            this.sendResponse(id, {
                outcome: {
                    outcome: 'selected',
                    optionId: chosenId,
                    option_id: chosenId
                }
            });
            return;
        }

        // 2. If a permission request handler was registered:
        if (this.permissionRequestHandler) {
            const chosenOptionId = await this.permissionRequestHandler({
                id,
                sessionId: params?.sessionId || this.currentSessionId || '',
                requestId: String(id),
                toolCall,
                options: normalizedOptions
            });

            this.logger.info(`User permission decision for ${toolName}: ${chosenOptionId}`);
            if (chosenOptionId && chosenOptionId !== 'deny' && chosenOptionId !== 'cancel') {
                this.sendResponse(id, {
                    outcome: {
                        outcome: 'selected',
                        optionId: chosenOptionId,
                        option_id: chosenOptionId
                    }
                });
            } else {
                this.sendResponse(id, {
                    outcome: {
                        outcome: 'selected',
                        optionId: 'deny',
                        option_id: 'deny'
                    }
                });
            }
            return;
        }

        // 3. Fallback: emit event
        this.emit('permissionRequest', {
            id,
            sessionId: params?.sessionId || this.currentSessionId || '',
            requestId: String(id),
            toolCall,
            options: normalizedOptions
        });
    }

    private handleNotification(method: string, params: any): void {
        switch (method) {
            case 'session/update': {
                // Internal listener for history replay termination
                this.emit('_internalSessionUpdate', params);

                // Normalization of ACP standard sessionUpdate and legacy formats
                const updatePayload = params?.update || params;
                const updateKind = updatePayload?.sessionUpdate || updatePayload?.session_update || updatePayload?.kind || updatePayload?.type;
                const sessionId = params?.sessionId || params?.session_id || this.currentSessionId || '';

                // Always emit usage_update even during history replay so Session Load hydrates real context usage!
                if (this.isReplayingHistory && updateKind !== 'usage_update' && updateKind !== 'usage') {
                    return;
                }
                if (this.suppressTurnEvents && updateKind !== 'usage_update' && updateKind !== 'usage') {
                    return;
                }

                this.emit('sessionUpdate', params);

                if (updateKind === 'agent_thought_chunk' || updateKind === 'thought_chunk' || updateKind === 'thought') {
                    const text = this.extractTextContent(updatePayload.content);
                    if (text) {
                        this.emit('thoughtChunk', text, sessionId);
                    }
                } else if (updateKind === 'agent_message_chunk' || updateKind === 'message_chunk' || updateKind === 'content') {
                    const text = this.extractTextContent(updatePayload.content);
                    if (text) {
                        this.emit('messageChunk', text, sessionId);
                    }
                } else if (updateKind === 'tool_call' || updateKind === 'tool.started') {
                    const toolCall = {
                        id: updatePayload.toolCallId || updatePayload.id || `tc-${Date.now()}`,
                        name: this.extractToolName(updatePayload),
                        title: updatePayload.title || updatePayload.name,
                        args: updatePayload.rawInput || updatePayload.args || updatePayload.arguments || (updatePayload.locations ? { locations: updatePayload.locations } : {}),
                        kind: updatePayload.kind || 'other',
                        status: 'running'
                    };
                    this.emit('toolCallStart', toolCall, sessionId);
                } else if (updateKind === 'tool_call_update' || updateKind === 'tool.completed') {
                    const toolUpdate = {
                        id: updatePayload.toolCallId || updatePayload.id,
                        status: updatePayload.status === 'completed' ? 'done' : (updatePayload.status || 'done'),
                        result: this.extractTextContent(updatePayload.content) || updatePayload.rawOutput || updatePayload.result,
                        error: updatePayload.error
                    };
                    this.emit('toolCallUpdate', toolUpdate, sessionId);
                } else if (updateKind === 'plan') {
                    this.emit('planUpdate', updatePayload.entries || updatePayload.content, sessionId);
                } else if (updateKind === 'usage_update' || updateKind === 'usage') {
                    const usage: ACPTokenUsage = {
                        promptTokens: updatePayload.inputTokens || updatePayload.promptTokens || updatePayload.used || 0,
                        completionTokens: updatePayload.outputTokens || updatePayload.completionTokens || 0,
                        totalTokens: updatePayload.totalTokens || updatePayload.used || 0,
                        maxContextTokens: updatePayload.size || updatePayload.modelContextWindow,
                        cachedTokens: updatePayload.cachedTokens || updatePayload.cachedInputTokens
                    };
                    (usage as any).reasoningTokens = updatePayload.reasoningTokens || 0;
                    this.emit('tokenUsage', usage);
                }
                break;
            }
            case 'session/request_permission':
            case 'session/requestPermission':
            case 'permission/request':
                this.emit('permissionRequest', params);
                break;
            case 'tool/call':
                this.emit('toolCall', params);
                break;
            case 'token/usage':
            case 'usage/update': {
                const u = params?.usage || params || {};
                const usage: ACPTokenUsage = {
                    promptTokens: u.promptTokens || u.inputTokens || u.used || 0,
                    completionTokens: u.completionTokens || u.outputTokens || 0,
                    totalTokens: u.totalTokens || u.used || ((u.inputTokens || 0) + (u.outputTokens || 0)),
                    maxContextTokens: u.size || u.maxContextTokens || u.modelContextWindow,
                    cachedTokens: u.cachedTokens || u.cachedInputTokens
                };
                this.emit('tokenUsage', usage);
                break;
            }
            default:
                this.logger.debug(`Unhandled notification: ${method}`, params);
        }
    }

    private extractTextContent(content: any): string {
        if (!content) return '';
        if (typeof content === 'string') return content;
        if (content.text) return content.text;
        if (Array.isArray(content)) {
            return content.map(item => {
                if (typeof item === 'string') return item;
                if (item.text) return item.text;
                if (item.content) return this.extractTextContent(item.content);
                return '';
            }).join('');
        }
        if (typeof content === 'object') {
            if (content.content) return this.extractTextContent(content.content);
            try {
                return JSON.stringify(content);
            } catch {
                return '';
            }
        }
        return String(content);
    }

    private extractToolName(payload: any): string {
        if (payload.name) return payload.name;
        if (payload.title && typeof payload.title === 'string') {
            const parts = payload.title.split(':');
            if (parts.length > 0 && parts[0].trim()) {
                return parts[0].trim();
            }
        }
        return payload.kind || 'tool';
    }

    private async sendRequest(method: string, params: any, timeoutMs: number = 30000): Promise<any> {
        if (!this.process || !this.process.stdin) {
            throw new Error('Hermes ACP is not connected');
        }

        const id = ++this.messageId;
        const message: ACPMessage = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: (val) => {
                    clearTimeout(timer);
                    resolve(val);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                }
            });

            const data = JSON.stringify(message) + '\n';
            this.process!.stdin!.write(data, (error) => {
                if (error) {
                    clearTimeout(timer);
                    this.pendingRequests.delete(id);
                    reject(error);
                }
            });
        });
    }

    private captureSessionCapabilities(response: any): void {
        if (!response || typeof response !== 'object') return;
        const modelsBlock = response.models;
        if (modelsBlock && Array.isArray(modelsBlock.availableModels)) {
            this.availableAcpModels = modelsBlock.availableModels;
            this.currentAcpModelId = modelsBlock.currentModelId || this.currentAcpModelId || '';
            this.emit('modelsUpdated', {
                availableModels: this.availableAcpModels,
                currentModelId: this.currentAcpModelId
            });
        }
        const modesBlock = response.modes;
        if (modesBlock && Array.isArray(modesBlock.availableModes)) {
            this.availableAcpModes = modesBlock.availableModes;
        }
    }

    async createSession(cwd: string): Promise<ACPSession> {
        const safeCwd = getHermesSafeCwd(cwd);
        const response = await this.sendRequest('session/new', {
            cwd: safeCwd,
            mcpServers: []
        }, 30000);
        this.currentSessionId = response.sessionId;
        this.captureSessionCapabilities(response);

        if (this.autoApproveEnabled && this.currentSessionId) {
            this.setSessionMode(this.currentSessionId, 'accept_edits').catch(() => {});
        }

        return response;
    }

    async loadSession(sessionId: string, cwd: string): Promise<ACPSession | null> {
        const safeCwd = getHermesSafeCwd(cwd);
        this.isReplayingHistory = true;
        try {
            const response = await this.sendRequest('session/load', {
                sessionId,
                cwd: safeCwd,
                mcpServers: []
            }, 30000);
            if (response) {
                this.currentSessionId = response.sessionId;
                this.captureSessionCapabilities(response);
            }
            await this.waitForHistoryReplay();

            if (this.autoApproveEnabled && this.currentSessionId) {
                this.setSessionMode(this.currentSessionId, 'accept_edits').catch(() => {});
            }

            return response;
        } finally {
            this.isReplayingHistory = false;
        }
    }

    private waitForHistoryReplay(): Promise<void> {
        return new Promise((resolve) => {
            const handler = (update: any) => {
                const updatePayload = update?.update || update;
                const updateKind = updatePayload?.sessionUpdate || updatePayload?.session_update || updatePayload?.kind || updatePayload?.type;
                if (updateKind === 'history_end' || updateKind === 'history_complete' || updateKind === 'turn_complete') {
                    this.off('_internalSessionUpdate', handler);
                    resolve();
                }
            };
            this.on('_internalSessionUpdate', handler);

            setTimeout(() => {
                this.off('_internalSessionUpdate', handler);
                resolve();
            }, 1500);
        });
    }

    async sendPrompt(sessionId: string, prompt: string, attachments?: any[]): Promise<any> {
        const promptItems: any[] = [
            {
                type: 'text',
                text: prompt
            }
        ];

        if (attachments && Array.isArray(attachments)) {
            for (const att of attachments) {
                if (att.type === 'image' && att.data) {
                    promptItems.push({
                        type: 'image',
                        data: att.data,
                        mimeType: att.mimeType || 'image/png'
                    });
                } else if (att.content) {
                    promptItems.push({
                        type: 'resource',
                        resource: {
                            uri: att.path ? `file://${att.path}` : `memory://${att.name}`,
                            text: att.content
                        }
                    });
                }
            }
        }

        // Prompts can take several minutes to generate and execute tools
        const result = await this.sendRequest('session/prompt', {
            sessionId,
            prompt: promptItems
        }, 180000);

        if (result && result.usage) {
            const u = result.usage;
            this.emit('tokenUsage', {
                promptTokens: u.inputTokens || u.promptTokens || 0,
                completionTokens: u.outputTokens || u.completionTokens || 0,
                totalTokens: u.totalTokens || ((u.inputTokens || 0) + (u.outputTokens || 0)),
                cachedTokens: u.cachedInputTokens || u.cachedTokens
            });
        }

        return result;
    }

    async compressContext(sessionId: string): Promise<any> {
        this.logger.info(`Requesting context compression (/compress) for session: ${sessionId}`);
        return await this.sendPrompt(sessionId, '/compress');
    }

    async resetSession(sessionId: string): Promise<any> {
        this.logger.info(`Resetting live ACP session RAM state (/reset) for session: ${sessionId}`);
        this.suppressTurnEvents = true;
        try {
            return await this.sendPrompt(sessionId, '/reset');
        } finally {
            this.suppressTurnEvents = false;
        }
    }

    async cancelTurn(sessionId: string): Promise<void> {
        await this.sendRequest('session/cancel', {
            sessionId
        }, 10000);
    }

    async listSessions(): Promise<any[]> {
        const response = await this.sendRequest('session/list', {}, 20000);
        return response.sessions || [];
    }

    async getAvailableModels(_sessionId?: string): Promise<any[]> {
        return [...this.availableAcpModels];
    }

    getCurrentAcpModelId(): string {
        return this.currentAcpModelId;
    }

    async getAvailableProviders(_sessionId?: string): Promise<any[]> {
        const seen = new Set<string>();
        const providers: Array<{ id: string; name: string }> = [];
        for (const m of this.availableAcpModels) {
            const pid = m?.provider || (typeof m?.modelId === 'string' && m.modelId.includes('/') ? m.modelId.split('/')[0] : '');
            if (pid && !seen.has(pid)) {
                seen.add(pid);
                providers.push({ id: pid, name: pid });
            }
        }
        return providers;
    }

    async setModel(sessionId: string, modelId: string): Promise<void> {
        await this.sendRequest('session/setModel', {
            sessionId,
            model: modelId
        }, 15000);
    }

    async setSessionMode(sessionId: string, mode: string): Promise<void> {
        try {
            await this.sendRequest('session/setMode', {
                sessionId,
                modeId: mode
            }, 10000);
        } catch {
            try {
                await this.sendRequest('session/set_mode', {
                    sessionId,
                    mode_id: mode
                }, 10000);
            } catch {
                // Ignore if mode setting is not supported by backend
            }
        }
    }

    async setConfigOption(configId: string, value: string, sessionId?: string): Promise<void> {
        const sid = sessionId || this.currentSessionId;
        if (!sid) {
            this.logger.warn(`Cannot set config option ${configId}: no active session`);
            return;
        }

        try {
            await this.sendRequest('session/setConfigOption', {
                sessionId: sid,
                configId,
                value
            }, 15000);
            this.logger.info(`Set ACP config option '${configId}' to '${value}' on session ${sid}`);
        } catch {
            try {
                await this.sendRequest('session/set_config_option', {
                    sessionId: sid,
                    config_id: configId,
                    value
                }, 15000);
                this.logger.info(`Set ACP config option '${configId}' to '${value}' (snake_case) on session ${sid}`);
            } catch (err) {
                this.logger.warn(`Could not set ACP config option '${configId}'`, err);
            }
        }
    }

    async setReasoningEffort(effort: string, sessionId?: string): Promise<void> {
        await this.setConfigOption('reasoning_effort', effort, sessionId);
    }

    async setProvider(_sessionId: string, providerId: string): Promise<void> {
        await this.setModel(_sessionId, providerId);
    }

    async getTokenUsage(_sessionId: string): Promise<ACPTokenUsage | null> {
        return null;
    }

    async injectSkills(sessionId: string, skillNames: string[]): Promise<void> {
        try {
            await this.sendRequest('session/configure', {
                sessionId,
                config: {
                    skills: skillNames
                }
            }, 15000);
        } catch {
            await this.sendPrompt(sessionId, `/skill ${skillNames.join(' ')}`);
        }
    }

    on(event: 'connected', listener: () => void): this;
    on(event: 'disconnected', listener: (reason: string) => void): this;
    on(event: 'sessionUpdate', listener: (update: ACPSessionUpdate) => void): this;
    on(event: '_internalSessionUpdate', listener: (params: any) => void): this;
    on(event: 'thoughtChunk', listener: (text: string, sessionId: string) => void): this;
    on(event: 'messageChunk', listener: (text: string, sessionId: string) => void): this;
    on(event: 'toolCallStart', listener: (toolCall: any, sessionId: string) => void): this;
    on(event: 'toolCallUpdate', listener: (toolCall: any, sessionId: string) => void): this;
    on(event: 'planUpdate', listener: (plan: any, sessionId: string) => void): this;
    on(event: 'permissionRequest', listener: (request: ACPPermissionRequest) => void): this;
    on(event: 'toolCall', listener: (toolCall: ACPToolCall) => void): this;
    on(event: 'tokenUsage', listener: (usage: ACPTokenUsage) => void): this;
    on(event: 'modelsUpdated', listener: (payload: { availableModels: any[]; currentModelId: string }) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    off(event: '_internalSessionUpdate', listener: (params: any) => void): this;
    off(event: string, listener: (...args: any[]) => void): this {
        return super.off(event, listener);
    }

    emit(event: 'connected'): boolean;
    emit(event: 'disconnected', reason: string): boolean;
    emit(event: 'sessionUpdate', update: ACPSessionUpdate): boolean;
    emit(event: '_internalSessionUpdate', params: any): boolean;
    emit(event: 'thoughtChunk', text: string, sessionId: string): boolean;
    emit(event: 'messageChunk', text: string, sessionId: string): boolean;
    emit(event: 'toolCallStart', toolCall: any, sessionId: string): boolean;
    emit(event: 'toolCallUpdate', toolCall: any, sessionId: string): boolean;
    emit(event: 'planUpdate', plan: any, sessionId: string): boolean;
    emit(event: 'permissionRequest', request: ACPPermissionRequest): boolean;
    emit(event: 'toolCall', toolCall: ACPToolCall): boolean;
    emit(event: 'tokenUsage', usage: ACPTokenUsage): boolean;
    emit(event: 'modelsUpdated', payload: { availableModels: any[]; currentModelId: string }): boolean;
    emit(event: 'error', error: Error): boolean;
    emit(event: string, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    private cleanup(): void {
        if (this.process) {
            try {
                this.process.kill('SIGTERM');
            } catch {
                // ignore
            }
            this.process = null;
        }
        this.isConnected = false;
    }
}
