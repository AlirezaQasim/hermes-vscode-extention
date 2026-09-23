import type { Logger } from '../utils/logger';
import { HermesDatabase } from '../config/hermesConfig';
import type { HermesSession } from '../config/hermesConfig';

interface SessionState {
    sessionId: string;
    cwd: string;
    model: string;
    provider?: string;
    history: any[];
    createdAt: Date;
    updatedAt: Date;
    isLoadedFromDB: boolean;
}

export class SessionManager {
    private logger: Logger;
    private sessions = new Map<string, SessionState>();
    private currentSessionId: string | null = null;
    private hermesDb: HermesDatabase;

    constructor(logger: Logger) {
        this.logger = logger;
        this.hermesDb = new HermesDatabase(logger);
    }

    async initialize(): Promise<void> {
        // Load existing sessions from Hermes database
        await this.loadSessionsFromDatabase();
    }

    private async loadSessionsFromDatabase(): Promise<void> {
        if (!this.hermesDb.databaseExists()) {
            this.logger.info('Hermes database not found, starting fresh');
            return;
        }

        try {
            // For now, we rely on ACP listSessions which reads from the database
            // The actual loading happens when we connect to ACP
            this.logger.info('Hermes database found, sessions will be loaded via ACP');
        } catch (error) {
            this.logger.error('Failed to initialize from database', error);
        }
    }

    createSession(sessionId: string, cwd: string, model: string = '', provider: string = ''): SessionState {
        const state: SessionState = {
            sessionId,
            cwd,
            model,
            provider,
            history: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            isLoadedFromDB: false
        };
        this.sessions.set(sessionId, state);
        this.currentSessionId = sessionId;
        this.logger.debug('Created session', sessionId);
        return state;
    }

    loadSessionFromACP(session: HermesSession): SessionState {
        const state: SessionState = {
            sessionId: session.id,
            cwd: session.cwd || '',
            model: session.model || '',
            provider: session.provider || '',
            history: [], // Will be loaded via ACP load
            createdAt: new Date(session.createdAt),
            updatedAt: new Date(session.updatedAt),
            isLoadedFromDB: true
        };
        this.sessions.set(session.id, state);
        this.logger.debug('Loaded session from ACP', session.id);
        return state;
    }

    getSession(sessionId: string): SessionState | undefined {
        return this.sessions.get(sessionId);
    }

    getCurrentSession(): SessionState | undefined {
        if (this.currentSessionId) {
            return this.sessions.get(this.currentSessionId);
        }
        return undefined;
    }

    setCurrentSession(sessionId: string): void {
        if (this.sessions.has(sessionId)) {
            this.currentSessionId = sessionId;
        }
    }

    getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    updateSession(sessionId: string, updates: Partial<SessionState>): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            Object.assign(session, updates, { updatedAt: new Date() });
        }
    }

    addMessage(sessionId: string, message: any): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.history.push({
                ...message,
                timestamp: new Date()
            });
            session.updatedAt = new Date();
        }
    }

    setHistory(sessionId: string, history: any[]): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.history = history;
            session.updatedAt = new Date();
        }
    }

    getHistory(sessionId: string): any[] {
        const session = this.sessions.get(sessionId);
        return session?.history || [];
    }

    listSessions(): SessionState[] {
        return Array.from(this.sessions.values())
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    listAllSessions(): SessionState[] {
        return Array.from(this.sessions.values())
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    removeSession(sessionId: string): boolean {
        const deleted = this.sessions.delete(sessionId);
        if (this.currentSessionId === sessionId) {
            this.currentSessionId = null;
        }
        return deleted;
    }

    clear(): void {
        this.sessions.clear();
        this.currentSessionId = null;
    }

    getHermesDb(): HermesDatabase {
        return this.hermesDb;
    }
}