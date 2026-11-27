import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../utils/logger';
import { getHermesHome, getPythonExecutablePath } from '../utils/hermesPaths';

export interface HermesSession {
    id: string;
    title?: string;
    preview?: string;
    model?: string;
    provider?: string;
    cwd?: string;
    messageCount: number;
    createdAt: number;
    updatedAt: number;
    source?: string;
    archived?: boolean;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    reasoningTokens?: number;
    apiCallCount?: number;
}

interface PendingRequest {
    resolve: (data: any) => void;
    reject: (err: any) => void;
    timer: NodeJS.Timeout;
}

export class SessionService {
    private logger: Logger;
    private dbPath: string;
    private daemonProcess: ChildProcess | null = null;
    private pendingRequests = new Map<string, PendingRequest>();
    private requestCounter = 0;
    private stdoutBuffer = '';
    private isStarting = false;

    constructor(logger: Logger) {
        this.logger = logger;
        this.dbPath = path.join(getHermesHome(), 'state.db');
        this.ensureDaemonStarted();
    }

    private getScriptPath(): string {
        const candidates = [
            path.join(__dirname, '..', 'utils', 'hermesDb.py'),
            path.join(__dirname, 'utils', 'hermesDb.py'),
            path.join(__dirname, '..', 'src', 'utils', 'hermesDb.py'),
            path.join(process.cwd(), 'src', 'utils', 'hermesDb.py')
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        return candidates[0] || 'hermesDb.py';
    }

    private ensureDaemonStarted(): void {
        if (this.daemonProcess && !this.daemonProcess.killed) {
            return;
        }
        if (this.isStarting) {
            return;
        }
        this.isStarting = true;

        try {
            const pythonExe = getPythonExecutablePath();
            const scriptPath = this.getScriptPath();

            this.logger.info(`Spawning Hermes DB Daemon: ${pythonExe} -u ${scriptPath} --daemon`);

            this.daemonProcess = spawn(pythonExe, ['-u', scriptPath, '--daemon'], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            });

            this.daemonProcess.stdout?.on('data', (chunk: Buffer) => {
                this.stdoutBuffer += chunk.toString('utf8');
                this.processStdoutBuffer();
            });

            this.daemonProcess.stderr?.on('data', (chunk: Buffer) => {
                this.logger.debug(`Hermes DB Daemon stderr: ${chunk.toString('utf8').trim()}`);
            });

            this.daemonProcess.on('exit', (code, signal) => {
                this.logger.warn(`Hermes DB Daemon exited (code=${code}, signal=${signal})`);
                this.daemonProcess = null;
                // Reject all pending
                for (const [, req] of this.pendingRequests.entries()) {
                    clearTimeout(req.timer);
                    req.reject(new Error(`Daemon exited before completing request`));
                }
                this.pendingRequests.clear();
            });

            this.daemonProcess.on('error', (err) => {
                this.logger.error('Hermes DB Daemon error:', err);
            });
        } catch (error) {
            this.logger.error('Failed to spawn DB daemon:', error);
        } finally {
            this.isStarting = false;
        }
    }

    private processStdoutBuffer(): void {
        const lines = this.stdoutBuffer.split('\n');
        // Keep the last partial line in buffer
        this.stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const res = JSON.parse(trimmed);
                const reqId = res.id;
                if (reqId && this.pendingRequests.has(reqId)) {
                    const pending = this.pendingRequests.get(reqId)!;
                    this.pendingRequests.delete(reqId);
                    clearTimeout(pending.timer);

                    if (res.success) {
                        pending.resolve(res.data);
                    } else {
                        pending.reject(new Error(res.error || 'Daemon request failed'));
                    }
                }
            } catch (err) {
                this.logger.error('Failed to parse DB daemon JSON response line:', line, err);
            }
        }
    }

    private sendRequest(action: string, params: Record<string, any> = {}, timeoutMs: number = 15000): Promise<any> {
        return new Promise((resolve, reject) => {
            this.ensureDaemonStarted();
            if (!this.daemonProcess || !this.daemonProcess.stdin || !this.daemonProcess.stdin.writable) {
                reject(new Error('Hermes DB daemon is not available'));
                return;
            }

            const reqId = `req-${Date.now()}-${++this.requestCounter}`;
            const payload = {
                id: reqId,
                action,
                dbPath: this.dbPath,
                ...params
            };

            const timer = setTimeout(() => {
                if (this.pendingRequests.has(reqId)) {
                    this.pendingRequests.delete(reqId);
                    reject(new Error(`Timeout waiting for daemon response on action "${action}"`));
                }
            }, timeoutMs);

            this.pendingRequests.set(reqId, { resolve, reject, timer });
            this.daemonProcess.stdin.write(JSON.stringify(payload) + '\n');
        });
    }

    public async getSessions(limit: number = 50): Promise<HermesSession[]> {
        if (!fs.existsSync(this.dbPath)) {
            return [];
        }
        try {
            const raw = await this.sendRequest('list', { limit });
            if (!Array.isArray(raw)) return [];

            return raw.map((r: any) => ({
                id: r.id,
                title: r.title,
                model: r.model,
                cwd: r.cwd,
                messageCount: r.messageCount || 0,
                source: r.source || 'cli',
                createdAt: r.startedAt ? r.startedAt * 1000 : Date.now(),
                updatedAt: r.lastActive ? r.lastActive * 1000 : Date.now(),
                archived: Boolean(r.archived),
                inputTokens: Number(r.inputTokens || 0),
                outputTokens: Number(r.outputTokens || 0),
                cacheReadTokens: Number(r.cacheReadTokens || 0),
                reasoningTokens: Number(r.reasoningTokens || 0),
                apiCallCount: Number(r.apiCallCount || 0)
            }));
        } catch (error) {
            this.logger.error('SessionService.getSessions error:', error);
            return [];
        }
    }

    public async getSessionMessages(sessionId: string): Promise<any[]> {
        if (!fs.existsSync(this.dbPath)) {
            return [];
        }
        try {
            const messages = await this.sendRequest('messages', { sessionId });
            return Array.isArray(messages) ? messages : [];
        } catch (error) {
            this.logger.error(`SessionService.getSessionMessages error for ${sessionId}:`, error);
            return [];
        }
    }

    public async archiveSession(sessionId: string, archive: boolean = true): Promise<boolean> {
        if (!fs.existsSync(this.dbPath)) {
            return false;
        }
        try {
            const res = await this.sendRequest('archive', { sessionId, archive });
            if (res?.success === true) {
                return true;
            }
        } catch (error) {
            this.logger.warn(`Daemon archive request failed for ${sessionId}, attempting direct CLI fallback:`, error);
        }

        // Direct CLI fallback execution
        return new Promise<boolean>((resolve) => {
            try {
                const pythonExe = getPythonExecutablePath();
                const scriptPath = this.getScriptPath();
                const actionArg = archive ? 'archive' : 'restore';
                const cp = spawn(pythonExe, [scriptPath, 'archive', this.dbPath, sessionId, actionArg], {
                    windowsHide: true
                });
                let stdout = '';
                cp.stdout.on('data', d => { stdout += d.toString('utf8'); });
                cp.on('close', (code) => {
                    try {
                        const parsed = JSON.parse(stdout.trim() || '{}');
                        resolve(parsed.success === true);
                    } catch {
                        resolve(code === 0);
                    }
                });
                cp.on('error', (err) => {
                    this.logger.error(`Fallback archive error for ${sessionId}:`, err);
                    resolve(false);
                });
            } catch (fallbackErr) {
                this.logger.error(`Failed to launch fallback archive for ${sessionId}:`, fallbackErr);
                resolve(false);
            }
        });
    }

    public async deleteSession(sessionId: string): Promise<boolean> {
        if (!fs.existsSync(this.dbPath)) {
            return true;
        }
        try {
            const res = await this.sendRequest('delete', { sessionId });
            if (res?.success === true) {
                return true;
            }
        } catch (error) {
            this.logger.warn(`Daemon delete request failed for ${sessionId}, attempting direct CLI fallback:`, error);
        }

        // Direct CLI fallback execution
        return new Promise<boolean>((resolve) => {
            try {
                const pythonExe = getPythonExecutablePath();
                const scriptPath = this.getScriptPath();
                const cp = spawn(pythonExe, [scriptPath, 'delete', this.dbPath, sessionId], {
                    windowsHide: true
                });
                let stdout = '';
                cp.stdout.on('data', d => { stdout += d.toString('utf8'); });
                cp.on('close', (code) => {
                    try {
                        const parsed = JSON.parse(stdout.trim() || '{}');
                        resolve(parsed.success === true);
                    } catch {
                        resolve(code === 0);
                    }
                });
                cp.on('error', (err) => {
                    this.logger.error(`Fallback delete error for ${sessionId}:`, err);
                    resolve(false);
                });
            } catch (fallbackErr) {
                this.logger.error(`Failed to launch fallback delete for ${sessionId}:`, fallbackErr);
                resolve(false);
            }
        });
    }

    public async clearSessionMessages(sessionId: string): Promise<boolean> {
        if (!fs.existsSync(this.dbPath)) {
            return true;
        }
        try {
            const res = await this.sendRequest('clearMessages', { sessionId });
            if (res?.success === true) {
                return true;
            }
        } catch (error) {
            this.logger.warn(`Daemon clearMessages request failed for ${sessionId}, attempting direct CLI fallback:`, error);
        }

        // Direct CLI fallback execution
        return new Promise<boolean>((resolve) => {
            try {
                const pythonExe = getPythonExecutablePath();
                const scriptPath = this.getScriptPath();
                const cp = spawn(pythonExe, [scriptPath, 'clear', this.dbPath, sessionId], {
                    windowsHide: true
                });
                let stdout = '';
                cp.stdout.on('data', d => { stdout += d.toString('utf8'); });
                cp.on('close', (code) => {
                    try {
                        const parsed = JSON.parse(stdout.trim() || '{}');
                        resolve(parsed.success === true);
                    } catch {
                        resolve(code === 0);
                    }
                });
                cp.on('error', (err) => {
                    this.logger.error(`Fallback clearMessages error for ${sessionId}:`, err);
                    resolve(false);
                });
            } catch (fallbackErr) {
                this.logger.error(`Failed to launch fallback clearMessages for ${sessionId}:`, fallbackErr);
                resolve(false);
            }
        });
    }

    public async getSessionUsage(sessionId?: string): Promise<any> {
        try {
            const res = await this.sendRequest('session_usage', { sessionId: sessionId || '' }, 8000);
            if (res && typeof res === 'object') {
                return res;
            }
        } catch (error) {
            this.logger.warn('Daemon session_usage failed, falling back to direct CLI:', error);
        }
        return new Promise<any>((resolve) => {
            try {
                const cp = spawn(getPythonExecutablePath(), [this.getScriptPath(), 'session_usage', this.dbPath, sessionId || ''], {
                    windowsHide: true
                });
                let stdout = '';
                cp.stdout.on('data', d => { stdout += d.toString('utf8'); });
                cp.on('close', () => {
                    try {
                        resolve(JSON.parse(stdout.trim() || '{}'));
                    } catch {
                        resolve({});
                    }
                });
                cp.on('error', () => resolve({}));
            } catch {
                resolve({});
            }
        });
    }

    public async syncLiveCatalog(hermesHome: string, forceRefresh: boolean = true): Promise<any> {
        try {
            const res = await this.sendRequest('sync_catalog', { hermesHome, forceRefresh }, 25000);
            if (res && typeof res === 'object' && Array.isArray(res.providers)) {
                return res;
            }
        } catch (error) {
            this.logger.warn('Daemon sync_catalog failed, falling back to direct CLI:', error);
        }
        return new Promise<any>((resolve) => {
            try {
                const cp = spawn(getPythonExecutablePath(), [this.getScriptPath(), 'sync_catalog', hermesHome, this.dbPath], {
                    windowsHide: true
                });
                let stdout = '';
                const timer = setTimeout(() => {
                    try { cp.kill(); } catch {}
                    resolve(null);
                }, 25000);
                cp.stdout.on('data', d => { stdout += d.toString('utf8'); });
                cp.on('close', () => {
                    clearTimeout(timer);
                    try {
                        const parsed = JSON.parse(stdout.trim() || 'null');
                        resolve(parsed);
                    } catch {
                        resolve(null);
                    }
                });
                cp.on('error', () => {
                    clearTimeout(timer);
                    resolve(null);
                });
            } catch {
                resolve(null);
            }
        });
    }

    public dispose(): void {
        for (const [, req] of this.pendingRequests.entries()) {
            clearTimeout(req.timer);
            req.reject(new Error('SessionService disposed'));
        }
        this.pendingRequests.clear();

        if (this.daemonProcess) {
            try {
                this.daemonProcess.stdin?.end();
                this.daemonProcess.kill();
            } catch {
                // Ignore kill errors
            }
            this.daemonProcess = null;
        }
    }
}
