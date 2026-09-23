import type { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

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
}

export class HermesDatabase {
    private logger: Logger;
    private dbPath: string;

    constructor(logger: Logger) {
        this.logger = logger;
        this.dbPath = this.getDatabasePath();
    }

    private getDatabasePath(): string {
        const hermesHome = process.env.HERMES_HOME || 
            (process.platform === 'win32' 
                ? `${process.env.USERPROFILE}\\.hermes`
                : `${process.env.HOME}/.hermes`);
        return path.join(hermesHome, 'state.db');
    }

    async getSessions(): Promise<HermesSession[]> {
        try {
            // Check if database exists
            if (!fs.existsSync(this.dbPath)) {
                this.logger.warn('Hermes database not found', this.dbPath);
                return [];
            }

            // Use better-sqlite3 if available, otherwise return empty
            // For now, we'll use a simpler approach - read from the sessions directory
            // The ACP adapter stores sessions in the database, but we can also use the ACP list method
            return [];
        } catch (error) {
            this.logger.error('Failed to read Hermes database', error);
            return [];
        }
    }

    async loadSessionHistory(_sessionId: string): Promise<any[]> {
        // This would require better-sqlite3 or direct SQLite access
        // For now, return empty - sessions will be loaded via ACP list/load
        return [];
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
        const hermesHome = process.env.HERMES_HOME || 
            (process.platform === 'win32' 
                ? `${process.env.USERPROFILE}\\.hermes`
                : `${process.env.HOME}/.hermes`);
        this.configPath = path.join(hermesHome, 'config.yaml');
        this.envPath = path.join(hermesHome, '.env');
    }

    async readConfig(): Promise<any> {
        try {
            if (!fs.existsSync(this.configPath)) {
                return null;
            }
            const content = fs.readFileSync(this.configPath, 'utf8');
            // Simple YAML parsing for key fields
            return this.parseYaml(content);
        } catch (error) {
            this.logger.error('Failed to read config.yaml', error);
            return null;
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
        const result: any = {};
        let currentSection = result;
        const sectionStack: any[] = [result];
        
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            const indent = line.length - line.trimStart().length;
            
            // Handle section nesting
            while (sectionStack.length > 1 && indent <= this.getLastIndent(sectionStack)) {
                sectionStack.pop();
            }
            currentSection = sectionStack[sectionStack.length - 1];
            
            if (trimmed.endsWith(':')) {
                const key = trimmed.slice(0, -1).trim();
                currentSection[key] = {};
                sectionStack.push(currentSection[key]);
            } else if (trimmed.includes(':')) {
                const [key, ...valueParts] = trimmed.split(':');
                const value = valueParts.join(':').trim();
                if (key) {
                    currentSection[key.trim()] = this.parseValue(value);
                }
            }
        }
        return result;
    }

    private getLastIndent(_stack: any[]): number {
        // Simplified - just return a large number
        return 0;
    }

    private parseValue(value: string): any {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null' || value === '~') return null;
        if (/^\d+$/.test(value)) return parseInt(value, 10);
        if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
        // Remove quotes
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