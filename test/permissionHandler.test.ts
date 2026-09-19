import { PermissionHandler } from '../src/handlers/permissionHandler';
import { Logger } from '../src/utils/logger';

describe('PermissionHandler', () => {
  let permissionHandler: PermissionHandler;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = new Logger('Test');
    mockLogger.setLevel('error');
    permissionHandler = new PermissionHandler(mockLogger);
  });

  it('should auto-approve when enabled', async () => {
    permissionHandler.setAutoApprove(true);
    
    const request = {
      sessionId: 'session-1',
      requestId: 'req-1',
      toolCall: {
        name: 'write_file',
        args: { path: '/test.txt', content: 'hello' },
        kind: 'write'
      },
      options: ['allow', 'deny']
    };
    
    const result = await permissionHandler.handleRequest(request);
    expect(result).toBe('allow');
  });

  it('should return deny for unhandled requests when not auto-approve', async () => {
    permissionHandler.setAutoApprove(false);
    
    const request = {
      sessionId: 'session-1',
      requestId: 'req-1',
      toolCall: {
        name: 'terminal',
        args: { command: 'rm -rf /' },
        kind: 'execute'
      },
      options: ['allow', 'deny']
    };
    
    // The handler returns a promise that resolves when user clicks
    // In test, we can't simulate the click, so we test the pending request tracking
    const promise = permissionHandler.handleRequest(request);
    
    expect(permissionHandler.getPendingRequests()).toHaveLength(1);
    expect(permissionHandler.getPendingRequests()[0].requestId).toBe('req-1');
    
    // Cancel to avoid hanging promise
    permissionHandler.cancelRequest('req-1');
  });

  it('should track pending requests', () => {
    const request1 = {
      sessionId: 'session-1',
      requestId: 'req-1',
      toolCall: { name: 'tool1', args: {}, kind: 'read' },
      options: ['allow', 'deny']
    };
    
    const request2 = {
      sessionId: 'session-1',
      requestId: 'req-2',
      toolCall: { name: 'tool2', args: {}, kind: 'write' },
      options: ['allow', 'deny']
    };
    
    permissionHandler.handleRequest(request1);
    permissionHandler.handleRequest(request2);
    
    expect(permissionHandler.getPendingRequests()).toHaveLength(2);
    
    permissionHandler.cancelRequest('req-1');
    expect(permissionHandler.getPendingRequests()).toHaveLength(1);
    expect(permissionHandler.getPendingRequests()[0].requestId).toBe('req-2');
  });

  it('should clear all pending requests', () => {
    const request = {
      sessionId: 'session-1',
      requestId: 'req-1',
      toolCall: { name: 'tool1', args: {}, kind: 'read' },
      options: ['allow', 'deny']
    };
    
    permissionHandler.handleRequest(request);
    permissionHandler.clear();
    
    expect(permissionHandler.getPendingRequests()).toHaveLength(0);
  });
});