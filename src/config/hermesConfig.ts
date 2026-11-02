import type { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
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
}

export interface SkillInfo {
    name: string;
    description: string;
    category: string;
    path: string;
    dirPath: string;
    isLearned?: boolean;
}

export class HermesDatabase {
    private logger: Logger;
    private dbPath: string;

    constructor(logger: Logger) {
        this.logger = logger;
        this.dbPath = this.getDatabasePath();
    }

    private getDatabasePath(): string {
        const hermesHome = getHermesHome();
        return path.join(hermesHome, 'state.db');
    }

    private getScriptPath(): string {
        const candidates = [
            path.join(__dirname, '..', 'utils', 'hermesDb.py'),
            path.join(__dirname, 'utils', 'hermesDb.py'),
            path.join(__dirname, '..', 'src', 'utils', 'hermesDb.py')
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        return candidates[0] || path.join(__dirname, '..', 'utils', 'hermesDb.py');
    }

    async getSessions(limit: number = 50): Promise<HermesSession[]> {
        return new Promise((resolve) => {
            if (!fs.existsSync(this.dbPath)) {
                this.logger.debug('Hermes database not found', this.dbPath);
                resolve([]);
                return;
            }

            const script = this.getScriptPath();
            const pythonExe = getPythonExecutablePath();
            execFile(pythonExe, [script, 'list', this.dbPath, String(limit)], { timeout: 10000 }, (err, stdout) => {
                if (err) {
                    this.logger.warn('Failed to query sessions via python db helper:', err);
                    resolve([]);
                    return;
                }
                try {
                    const raw = JSON.parse(stdout.trim() || '[]');
                    const sessions: HermesSession[] = raw.map((r: any) => ({
                        id: r.id,
                        title: r.title,
                        model: r.model,
                        cwd: r.cwd,
                        messageCount: r.messageCount,
                        source: r.source,
                        createdAt: r.startedAt ? r.startedAt * 1000 : Date.now(),
                        updatedAt: r.lastActive ? r.lastActive * 1000 : Date.now()
                    }));
                    resolve(sessions);
                } catch (parseErr) {
                    this.logger.error('Failed to parse sessions JSON', parseErr);
                    resolve([]);
                }
            });
        });
    }

    async getSessionMessages(sessionId: string): Promise<any[]> {
        return new Promise((resolve) => {
            if (!fs.existsSync(this.dbPath)) {
                resolve([]);
                return;
            }

            const script = this.getScriptPath();
            const pythonExe = getPythonExecutablePath();
            execFile(pythonExe, [script, 'messages', this.dbPath, sessionId], { timeout: 10000 }, (err, stdout) => {
                if (err) {
                    this.logger.warn(`Failed to query messages for session ${sessionId}:`, err);
                    resolve([]);
                    return;
                }
                try {
                    const messages = JSON.parse(stdout.trim() || '[]');
                    resolve(messages);
                } catch (parseErr) {
                    this.logger.error('Failed to parse messages JSON', parseErr);
                    resolve([]);
                }
            });
        });
    }

    async getSkills(): Promise<SkillInfo[]> {
        return new Promise((resolve) => {
            const hermesHome = getHermesHome();
            const script = this.getScriptPath();
            const pythonExe = getPythonExecutablePath();
            execFile(pythonExe, [script, 'skills', hermesHome], { timeout: 10000 }, (err, stdout) => {
                if (err) {
                    this.logger.warn('Failed to query skills via python db helper:', err);
                    resolve([]);
                    return;
                }
                try {
                    const skills: SkillInfo[] = JSON.parse(stdout.trim() || '[]');
                    resolve(skills);
                } catch (parseErr) {
                    this.logger.error('Failed to parse skills JSON', parseErr);
                    resolve([]);
                }
            });
        });
    }

    async loadSessionHistory(sessionId: string): Promise<any[]> {
        return this.getSessionMessages(sessionId);
    }

    async getModelConfig(): Promise<any> {
        return new Promise((resolve) => {
            const hermesHome = getHermesHome();
            const script = this.getScriptPath();
            const pythonExe = getPythonExecutablePath();
            execFile(pythonExe, [script, 'models', hermesHome], { timeout: 10000 }, (err, stdout) => {
                if (err) {
                    this.logger.warn('Failed to query model config:', err);
                    resolve(null);
                    return;
                }
                try {
                    const data = JSON.parse(stdout.trim() || '{}');
                    resolve(data);
                } catch (parseErr) {
                    this.logger.error('Failed to parse model config JSON', parseErr);
                    resolve(null);
                }
            });
        });
    }

    async saveModelConfig(provider: string, model: string, apiKey?: string, baseUrl?: string): Promise<boolean> {
        return new Promise((resolve) => {
            const hermesHome = getHermesHome();
            const script = this.getScriptPath();
            const pythonExe = getPythonExecutablePath();
            const args = [script, 'save_model', provider, model, apiKey || '-', baseUrl || '-', hermesHome];
            execFile(pythonExe, args, { timeout: 10000 }, (err, stdout) => {
                if (err) {
                    this.logger.error('Failed to save model config:', err);
                    resolve(false);
                    return;
                }
                try {
                    const data = JSON.parse(stdout.trim() || '{}');
                    resolve(data.success === true);
                } catch {
                    resolve(false);
                }
            });
        });
    }

    databaseExists(): boolean {
        return fs.existsSync(this.dbPath);
    }

    getDbPath(): string {
        return this.dbPath;
    }
}

export class HermesConfig {
    private logger: Logger;
    private configPath: string;
    private envPath: string;

    constructor(logger: Logger) {
        this.logger = logger;
        const hermesHome = getHermesHome();
        this.configPath = path.join(hermesHome, 'config.yaml');
        this.envPath = path.join(hermesHome, '.env');
    }

    async readConfig(): Promise<any> {
        try {
            if (!fs.existsSync(this.configPath)) {
                return {};
            }
            const content = fs.readFileSync(this.configPath, 'utf8');
            return this.parseYaml(content) || {};
        } catch (error) {
            this.logger.error('Failed to read config.yaml', error);
            return {};
        }
    }

    async readEnv(): Promise<Record<string, string>> {
        try {
            if (!fs.existsSync(this.envPath)) {
                return {};
            }
            const content = fs.readFileSync(this.envPath, 'utf8');
            const env: Record<string, string> = {};
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const idx = trimmed.indexOf('=');
                    if (idx > 0) {
                        const key = trimmed.slice(0, idx).trim();
                        const value = trimmed.slice(idx + 1).trim();
                        env[key] = value;
                    }
                }
            }
            return env;
        } catch (error) {
            this.logger.error('Failed to read .env', error);
            return {};
        }
    }

    private parseYaml(content: string): any {
        const result: Record<string, any> = {};
        const lines = content.split(/\r?\n/);
        const stack: { indent: number; obj: Record<string, any> }[] = [{ indent: -1, obj: result }];

        for (const rawLine of lines) {
            const line = rawLine.replace(/#.*$/, ''); // strip comments
            if (!line.trim()) continue;

            const indent = line.search(/\S/);
            const trimmed = line.trim();

            while (stack.length > 1 && stack[stack.length - 1] && indent <= (stack[stack.length - 1]?.indent ?? -1)) {
                stack.pop();
            }
            const current = stack[stack.length - 1]?.obj ?? result;

            const colonIdx = trimmed.indexOf(':');
            if (colonIdx !== -1) {
                const key = trimmed.slice(0, colonIdx).trim();
                const rawVal = trimmed.slice(colonIdx + 1).trim();

                if (rawVal === '') {
                    // Nested object
                    const nextObj: Record<string, any> = {};
                    current[key] = nextObj;
                    stack.push({ indent, obj: nextObj });
                } else {
                    current[key] = this.parseValue(rawVal);
                }
            }
        }
        return result;
    }

    private parseValue(value: string): any {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null' || value === '~') return null;
        if (/^-?\d+$/.test(value)) return parseInt(value, 10);
        if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
            return value.slice(1, -1);
        }
        return value;
    }

    getConfigPath(): string {
        return this.configPath;
    }

    getEnvPath(): string {
        return this.envPath;
    }

    configExists(): boolean {
        return fs.existsSync(this.configPath);
    }

    envExists(): boolean {
        return fs.existsSync(this.envPath);
    }
}
