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
                const commandPath = getHermesCliPath(this.config.command);
                const hermesHome = getHermesHome();
                const safeCwd = getHermesSafeCwd(this.config.cwd);

                this.logger.info(`Starting Hermes ACP: command="${commandPath}", args=[${this.config.args.join(', ')}], cwd="${safeCwd}", HERMES_HOME="${hermesHome}"`);

                const env = { ...process.env, ...this.config.env, HERMES_HOME: hermesHome };

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

                // Send initialize request. Python ACP adapter may take 1-2 seconds to boot plugins.
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
                }, 1500);

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
            case 'token/usage':
            case 'usage/update':
                this.emit('tokenUsage', params);
                break;
            default:
                this.logger.debug(`Unhandled notification: ${method}`, params);
        }
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

    async createSession(cwd: string): Promise<ACPSession> {
        const safeCwd = getHermesSafeCwd(cwd);
        const response = await this.sendRequest('session/new', {
            cwd: safeCwd,
            mcpServers: []
        }, 30000);
        this.currentSessionId = response.sessionId;
        return response;
    }

    async loadSession(sessionId: string, cwd: string): Promise<ACPSession | null> {
        const safeCwd = getHermesSafeCwd(cwd);
        const response = await this.sendRequest('session/load', {
            sessionId,
            cwd: safeCwd,
            mcpServers: []
        }, 30000);
        if (response) {
            this.currentSessionId = response.sessionId;
        }
        await this.waitForHistoryReplay();
        return response;
    }

    private waitForHistoryReplay(): Promise<void> {
        return new Promise((resolve) => {
            const handler = (update: any) => {
                if (update.kind === 'history_end' || update.kind === 'history_complete') {
                    this.off('sessionUpdate', handler);
                    resolve();
                }
            };
            this.on('sessionUpdate', handler);

            setTimeout(() => {
                this.off('sessionUpdate', handler);
                resolve();
            }, 8000);
        });
    }

    async sendPrompt(sessionId: string, prompt: string): Promise<any> {
        // Prompts can take several minutes to generate and execute tools
        return await this.sendRequest('session/prompt', {
            sessionId,
            prompt: [
                {
                    type: 'text',
                    text: prompt
                }
            ]
        }, 600000);
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

    async getAvailableModels(_sessionId: string): Promise<any[]> {
        return [];
    }

    async getAvailableProviders(_sessionId: string): Promise<any[]> {
        return [];
    }

    async setModel(sessionId: string, modelId: string): Promise<void> {
        await this.sendRequest('session/setModel', {
            sessionId,
            model: modelId
        }, 15000);
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
    on(event: 'permissionRequest', listener: (request: ACPPermissionRequest) => void): this;
    on(event: 'toolCall', listener: (toolCall: ACPToolCall) => void): this;
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
    emit(event: 'tokenUsage', usage: ACPTokenUsage): boolean;
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
