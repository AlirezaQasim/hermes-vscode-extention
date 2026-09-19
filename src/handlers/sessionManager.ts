import { Logger } from '../utils/logger';

interface SessionState {
    sessionId: string;
    cwd: string;
    model: string;
    history: any[];
    createdAt: Date;
    updatedAt: Date;
}

export class SessionManager {
    private logger: Logger;
    private sessions = new Map<string, SessionState>();
    private currentSessionId: string | null = null;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    createSession(sessionId: string, cwd: string, model: string = ''): SessionState {
        const state: SessionState = {
            sessionId,
            cwd,
            model,
            history: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.sessions.set(sessionId, state);
        this.currentSessionId = sessionId;
        this.logger.debug('Created session', sessionId);
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

    getHistory(sessionId: string): any[] {
        const session = this.sessions.get(sessionId);
        return session?.history || [];
    }

    listSessions(): SessionState[] {
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
}