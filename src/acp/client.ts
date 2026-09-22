import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { Logger } from '../utils/logger';

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

export interface ACPPermissionRequest {
    sessionId: string;
    requestId: string;
    toolCall: any;
    options: string[];
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

    constructor(config: ACPClientConfig) {
        super();
        this.config = config;
        this.logger = new Logger('HermesACPClient');
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.logger.info(`Starting Hermes ACP: ${this.config.command} ${this.config.args.join(' ')}`);

                this.process = spawn(this.config.command, this.config.args, {
                    cwd: this.config.cwd,
                    env: this.config.env,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true
                });

                if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
                    throw new Error('Failed to create stdio pipes');
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
                    this.isConnected = false;
                    this.emit('disconnected', `Process exited (code: ${code}, signal: ${signal})`);
                });

                // Wait a bit for process to start, then initialize
                setTimeout(async () => {
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
                                version: '1.0.0'
                            }
                        });

                        this.logger.debug('Initialize response', initResponse);
                        this.isConnected = true;
                        this.emit('connected');
                        resolve();
                    } catch (error) {
                        this.logger.error('Initialize failed', error);
                        this.cleanup();
                        reject(error);
                    }
                }, 1000);

            } catch (error) {
                this.logger.error('Failed to spawn ACP process', error);
                reject(error);
            }
        });
    }

    async disconnect(): Promise<void> {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
        }
        this.isConnected = false;
        this.currentSessionId = null;
    }

    private handleStdout(data: string): void {
        this.buffer += data;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message: ACPMessage = JSON.parse(line);
                    this.handleMessage(message);
                } catch (error) {
                    this.logger.error('Failed to parse ACP message', error, line);
                }
            }
        }
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
        } else if (message.method) {
            this.handleNotification(message.method, message.params);
        }
    }

    private handleNotification(method: string, params: any): void {
        switch (method) {
            case 'session/update':
                this.emit('sessionUpdate', params);
                break;
            case 'permission/request':
                this.emit('permissionRequest', params);
                break;
            case 'tool/call':
                this.emit('toolCall', params);
                break;
            case 'message':
                this.emit('message', params);
                break;
            case 'usage/update':
                this.emit('tokenUsage', params);
                break;
            default:
                this.logger.debug(`Unhandled notification: ${method}`, params);
        }
    }

    private async sendRequest(method: string, params: any): Promise<any> {
        if (!this.process || !this.process.stdin) {
            throw new Error('Not connected');
        }

        const id = ++this.messageId;
        const message: ACPMessage = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            const data = JSON.stringify(message) + '\n';
            this.process!.stdin!.write(data, (error) => {
                if (error) {
                    this.pendingRequests.delete(id);
                    reject(error);
                }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${method} timed out`));
                }
            }, 30000);
        });
    }

    async createSession(cwd: string): Promise<ACPSession> {
        const response = await this.sendRequest('session/new', {
            cwd,
            mcpServers: []
        });
        this.currentSessionId = response.sessionId;
        return response;
    }

    async loadSession(sessionId: string, cwd: string): Promise<ACPSession | null> {
        const response = await this.sendRequest('session/load', {
            sessionId,
            cwd,
            mcpServers: []
        });
        if (response) {
            this.currentSessionId = response.sessionId;
        }
        return response;
    }

    async sendPrompt(sessionId: string, prompt: string): Promise<void> {
        await this.sendRequest('session/prompt', {
            sessionId,
            prompt: [
                {
                    type: 'text',
                    text: prompt
                }
            ]
        });
    }

    async cancelTurn(sessionId: string): Promise<void> {
        await this.sendRequest('session/cancel', {
            sessionId
        });
    }

    async listSessions(): Promise<any[]> {
        const response = await this.sendRequest('session/list', {});
        return response.sessions || [];
    }

    async getAvailableModels(_sessionId: string): Promise<any[]> {
        // This would be available from session creation or a models endpoint
        // For now, return empty - models are in the session response
        return [];
    }

    async getAvailableProviders(_sessionId: string): Promise<any[]> {
        return [];
    }

    async setModel(sessionId: string, modelId: string): Promise<void> {
        await this.sendRequest('session/setModel', {
            sessionId,
            model: modelId
        });
    }

    async setProvider(_sessionId: string, providerId: string): Promise<void> {
        // Provider switching might be done via model string (provider:model)
        await this.setModel(_sessionId, providerId);
    }

    async getTokenUsage(_sessionId: string): Promise<ACPTokenUsage | null> {
        // Would need a specific method or get from session updates
        return null;
    }

    async injectSkills(sessionId: string, skillNames: string[]): Promise<void> {
        // Inject skills as a steer command or via session config
        await this.sendRequest('session/prompt', {
            sessionId,
            prompt: [
                {
                    type: 'text',
                    text: `/skill ${skillNames.join(' ')}`
                }
            ]
        });
    }

    on(event: 'connected', listener: () => void): this;
    on(event: 'disconnected', listener: (reason: string) => void): this;
    on(event: 'sessionUpdate', listener: (update: ACPSessionUpdate) => void): this;
    on(event: 'permissionRequest', listener: (request: ACPPermissionRequest) => void): this;
    on(event: 'toolCall', listener: (toolCall: ACPToolCall) => void): this;
    on(event: 'message', listener: (message: any) => void): this;
    on(event: 'tokenUsage', listener: (usage: ACPTokenUsage) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    emit(event: 'connected'): boolean;
    emit(event: 'disconnected', reason: string): boolean;
    emit(event: 'sessionUpdate', update: ACPSessionUpdate): boolean;
    emit(event: 'permissionRequest', request: ACPPermissionRequest): boolean;
    emit(event: 'toolCall', toolCall: ACPToolCall): boolean;
    emit(event: 'message', message: any): boolean;
    emit(event: 'tokenUsage', usage: ACPTokenUsage): boolean;
    emit(event: 'error', error: Error): boolean;
    emit(event: string, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    private cleanup(): void {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
        }
        this.isConnected = false;
    }
}