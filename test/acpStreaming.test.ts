import { HermesACPClient } from '../src/acp/client';

describe('HermesACPClient Real-Time Event Pipeline', () => {
    let client: HermesACPClient;

    beforeEach(() => {
        client = new HermesACPClient({
            command: 'hermes',
            args: ['acp'],
            cwd: process.cwd(),
            env: {},
            logLevel: 'error'
        });
    });

    test('should normalize agent_thought_chunk and emit thoughtChunk event', (done) => {
        const thoughtPayload = {
            sessionId: 'test-session-123',
            update: {
                sessionUpdate: 'agent_thought_chunk',
                content: {
                    type: 'text',
                    text: 'Analyzing the request...'
                }
            }
        };

        client.on('thoughtChunk', (text, sessionId) => {
            expect(text).toBe('Analyzing the request...');
            expect(sessionId).toBe('test-session-123');
            done();
        });

        // Trigger notification
        (client as any).handleNotification('session/update', thoughtPayload);
    });

    test('should normalize agent_message_chunk and emit messageChunk event', (done) => {
        const messagePayload = {
            sessionId: 'test-session-123',
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                    type: 'text',
                    text: 'Here is the solution to your issue.'
                }
            }
        };

        client.on('messageChunk', (text, sessionId) => {
            expect(text).toBe('Here is the solution to your issue.');
            expect(sessionId).toBe('test-session-123');
            done();
        });

        (client as any).handleNotification('session/update', messagePayload);
    });

    test('should normalize tool_call and emit toolCallStart event', (done) => {
        const toolPayload = {
            sessionId: 'test-session-123',
            update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'tc-abc-123',
                title: 'read_file: src/config.ts',
                kind: 'read',
                rawInput: { path: 'src/config.ts' }
            }
        };

        client.on('toolCallStart', (toolCall, sessionId) => {
            expect(toolCall.id).toBe('tc-abc-123');
            expect(toolCall.name).toBe('read_file');
            expect(toolCall.status).toBe('running');
            expect(toolCall.args).toEqual({ path: 'src/config.ts' });
            expect(sessionId).toBe('test-session-123');
            done();
        });

        (client as any).handleNotification('session/update', toolPayload);
    });

    test('should normalize tool_call_update and emit toolCallUpdate event', (done) => {
        const toolUpdatePayload = {
            sessionId: 'test-session-123',
            update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'tc-abc-123',
                status: 'completed',
                content: [{ type: 'content', content: { type: 'text', text: 'File contents read successfully' } }]
            }
        };

        client.on('toolCallUpdate', (toolUpdate, sessionId) => {
            expect(toolUpdate.id).toBe('tc-abc-123');
            expect(toolUpdate.status).toBe('done');
            expect(toolUpdate.result).toBe('File contents read successfully');
            expect(sessionId).toBe('test-session-123');
            done();
        });

        (client as any).handleNotification('session/update', toolUpdatePayload);
    });

    test('should suppress chunk and tool events during history replay on session/load', () => {
        let thoughtEmitted = false;
        let messageEmitted = false;
        let toolEmitted = false;
        let sessionUpdateEmitted = false;

        client.on('thoughtChunk', () => { thoughtEmitted = true; });
        client.on('messageChunk', () => { messageEmitted = true; });
        client.on('toolCallStart', () => { toolEmitted = true; });
        client.on('sessionUpdate', () => { sessionUpdateEmitted = true; });

        // Simulate history replay mode active
        (client as any).isReplayingHistory = true;

        (client as any).handleNotification('session/update', {
            sessionId: 'replayed-session',
            update: { sessionUpdate: 'agent_thought_chunk', content: { text: 'Old thinking' } }
        });

        (client as any).handleNotification('session/update', {
            sessionId: 'replayed-session',
            update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Old response' } }
        });

        (client as any).handleNotification('session/update', {
            sessionId: 'replayed-session',
            update: { sessionUpdate: 'tool_call', toolCallId: 'tc-old', title: 'read_file' }
        });

        (client as any).handleNotification('session/update', {
            sessionId: 'replayed-session',
            update: { sessionUpdate: 'user_message_chunk', content: { text: 'Old user prompt' } }
        });

        expect(thoughtEmitted).toBe(false);
        expect(messageEmitted).toBe(false);
        expect(toolEmitted).toBe(false);
        expect(sessionUpdateEmitted).toBe(false);

        // Turn off history replay mode
        (client as any).isReplayingHistory = false;

        (client as any).handleNotification('session/update', {
            sessionId: 'live-session',
            update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Live response' } }
        });

        expect(messageEmitted).toBe(true);
        expect(sessionUpdateEmitted).toBe(true);
    });
});
