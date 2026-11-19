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
            expect(gemini.models.length).toBe(20);
            expect(gemini.models.some(m => m.id === 'gemini-3.5-flash-lite')).toBe(true);
            expect(gemini.models.some(m => m.id === 'gemini-3.8-flash')).toBe(true);
            expect(gemini.models.some(m => m.id.includes('claude'))).toBe(false);
            expect(gemini.models.some(m => m.id.includes('inkling'))).toBe(false);
        }

        const openrouter = modelConfig.providers.find(p => p.id === 'openrouter');
        expect(openrouter).toBeDefined();
        if (openrouter) {
            expect(openrouter.models.length).toBeGreaterThan(20);
            const freeNemotronUltra = openrouter.models.find(m => m.id === 'nvidia/nemotron-3-ultra-550b-a55b:free');
            expect(freeNemotronUltra).toBeDefined();
            expect(freeNemotronUltra?.tag).toBe('Free');

            const freeNemotronLightning = openrouter.models.find(m => m.id === 'nvidia/nemotron-3.5-lightning:free');
            expect(freeNemotronLightning).toBeDefined();
            expect(freeNemotronLightning?.tag).toBe('Free');

            const freeModels = openrouter.models.filter(m => m.tag === 'Free');
            expect(freeModels.length).toBeGreaterThanOrEqual(10);
        }
    });

    it('should cleanly persist API key in .env without duplicates', async () => {
        const initialEnv = await service.readEnv();
        const originalKey = initialEnv['OPENROUTER_API_KEY'] || '';

        const testKey = 'sk-or-v1-fakekey1234567890dummytestkey9876';
        const saved = await service.saveModelConfig('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', testKey);
        expect(saved).toBe(true);

        const env = await service.readEnv();
        expect(env['OPENROUTER_API_KEY']).toBe(testKey);

        const updatedConfig = await service.getModelConfig();
        const openrouter = updatedConfig.providers.find(p => p.id === 'openrouter');
        expect(openrouter?.hasKey).toBe(true);
        expect(openrouter?.keyMasked).toContain('••••••••');
        expect(openrouter?.keyMasked.endsWith('9876')).toBe(true);

        // Restore original user key if it existed
        if (originalKey) {
            await service.saveModelConfig('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', originalKey);
            const restoredEnv = await service.readEnv();
            expect(restoredEnv['OPENROUTER_API_KEY']).toBe(originalKey);
        }
    });
});
