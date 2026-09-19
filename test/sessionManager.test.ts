import { SessionManager } from '../src/handlers/sessionManager';
import { Logger } from '../src/utils/logger';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = new Logger('Test');
    mockLogger.setLevel('error'); // Suppress logs in tests
    sessionManager = new SessionManager(mockLogger);
  });

  it('should create and retrieve sessions', () => {
    const session = sessionManager.createSession('session-1', '/workspace', 'claude-3');
    
    expect(session.sessionId).toBe('session-1');
    expect(session.cwd).toBe('/workspace');
    expect(session.model).toBe('claude-3');
    expect(session.history).toEqual([]);
    
    const retrieved = sessionManager.getSession('session-1');
    expect(retrieved).toBe(session);
  });

  it('should track current session', () => {
    sessionManager.createSession('session-1', '/workspace');
    sessionManager.createSession('session-2', '/workspace');
    
    expect(sessionManager.getCurrentSessionId()).toBe('session-2');
    
    sessionManager.setCurrentSession('session-1');
    expect(sessionManager.getCurrentSessionId()).toBe('session-1');
  });

  it('should add messages to session history', () => {
    sessionManager.createSession('session-1', '/workspace');
    
    sessionManager.addMessage('session-1', { role: 'user', content: 'Hello' });
    sessionManager.addMessage('session-1', { role: 'assistant', content: 'Hi there!' });
    
    const history = sessionManager.getHistory('session-1');
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  it('should list sessions sorted by updated time', () => {
    sessionManager.createSession('session-1', '/workspace');
    sessionManager.createSession('session-2', '/workspace');
    sessionManager.createSession('session-3', '/workspace');
    
    // Update session-1 to make it most recent
    sessionManager.updateSession('session-1', { model: 'updated-model' });
    
    const sessions = sessionManager.listSessions();
    expect(sessions[0].sessionId).toBe('session-1');
    expect(sessions[1].sessionId).toBe('session-3');
    expect(sessions[2].sessionId).toBe('session-2');
  });

  it('should remove sessions', () => {
    sessionManager.createSession('session-1', '/workspace');
    sessionManager.createSession('session-2', '/workspace');
    
    expect(sessionManager.removeSession('session-1')).toBe(true);
    expect(sessionManager.getSession('session-1')).toBeUndefined();
    expect(sessionManager.listSessions()).toHaveLength(1);
    
    expect(sessionManager.removeSession('nonexistent')).toBe(false);
  });

  it('should clear all sessions', () => {
    sessionManager.createSession('session-1', '/workspace');
    sessionManager.createSession('session-2', '/workspace');
    
    sessionManager.clear();
    
    expect(sessionManager.listSessions()).toHaveLength(0);
    expect(sessionManager.getCurrentSessionId()).toBeNull();
  });
});