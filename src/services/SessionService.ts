import { ChildProcess, spawn } from 'child_process';
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

            this.logger.info(`Spawning Hermes DB Daemon: ${pythonExe} ${scriptPath} --daemon`);

            this.daemonProcess = spawn(pythonExe, [scriptPath, '--daemon'], {
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

    private sendRequest(action: string, params: Record<string, any> = {}): Promise<any> {
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
            }, 8000);

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
                archived: Boolean(r.archived)
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
        try {
            const res = await this.sendRequest('archive', { sessionId, archive });
            return res?.success === true;
        } catch (error) {
            this.logger.error(`SessionService.archiveSession error for ${sessionId}:`, error);
            return false;
        }
    }

    public async deleteSession(sessionId: string): Promise<boolean> {
        try {
            const res = await this.sendRequest('delete', { sessionId });
            return res?.success === true;
        } catch (error) {
            this.logger.error(`SessionService.deleteSession error for ${sessionId}:`, error);
            return false;
        }
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
