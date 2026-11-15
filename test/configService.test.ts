import { ConfigService, FALLBACK_PROVIDERS } from '../src/services/ConfigService';
import { Logger } from '../src/utils/logger';

describe('ConfigService', () => {
    let service: ConfigService;
    let logger: Logger;

    beforeEach(() => {
        logger = new Logger('TestConfigService');
        service = new ConfigService(logger);
    });

    afterEach(() => {
        service.dispose();
    });

    it('should have fallback providers defined', () => {
        expect(FALLBACK_PROVIDERS.length).toBeGreaterThan(5);
        expect(FALLBACK_PROVIDERS.some(p => p.id === 'openrouter')).toBe(true);
        expect(FALLBACK_PROVIDERS.some(p => p.id === 'gemini')).toBe(true);
    });

    it('should parse YAML configuration correctly', async () => {
        const config = await service.readConfig();
        expect(typeof config).toBe('object');
    });

    it('should retrieve model configuration structure', async () => {
        const modelConfig = await service.getModelConfig();
        expect(modelConfig).toBeDefined();
        expect(modelConfig.current).toBeDefined();
        expect(Array.isArray(modelConfig.providers)).toBe(true);
        expect(modelConfig.providers.length).toBeGreaterThan(0);

        const gemini = modelConfig.providers.find(p => p.id === 'gemini');
        expect(gemini).toBeDefined();
        if (gemini) {
            expect(gemini.models.length).toBe(19);
            expect(gemini.models.some(m => m.id === 'gemini-3.5-flash-lite')).toBe(true);
            expect(gemini.models.some(m => m.id === 'gemini-3.8-flash')).toBe(true);
            expect(gemini.models.some(m => m.id.includes('claude'))).toBe(false);
            expect(gemini.models.some(m => m.id.includes('inkling'))).toBe(false);
        }
    });
});
