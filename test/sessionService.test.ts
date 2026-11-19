import { SessionService } from '../src/services/SessionService';
import { Logger } from '../src/utils/logger';

describe('SessionService', () => {
    let sessionService: SessionService;
    let logger: Logger;

    beforeEach(() => {
        logger = new Logger('TestSessionService');
        sessionService = new SessionService(logger);
    });

    afterEach(() => {
        if (sessionService) {
            sessionService.dispose();
        }
    });

    it('should initialize and have deleteSession and archiveSession methods', () => {
        expect(typeof sessionService.deleteSession).toBe('function');
        expect(typeof sessionService.archiveSession).toBe('function');
        expect(typeof sessionService.getSessions).toBe('function');
        expect(typeof sessionService.getSessionMessages).toBe('function');
    });

    it('should return empty list if db does not exist', async () => {
        const sessions = await sessionService.getSessions();
        expect(Array.isArray(sessions)).toBe(true);
    });

    it('should safely handle deleteSession for non-existent session ID without crashing', async () => {
        const result = await sessionService.deleteSession('non-existent-test-uuid-999');
        expect(typeof result).toBe('boolean');
    });

    it('should safely handle archiveSession for non-existent session ID without crashing', async () => {
        const result = await sessionService.archiveSession('non-existent-test-uuid-999', true);
        expect(typeof result).toBe('boolean');
    });
});
