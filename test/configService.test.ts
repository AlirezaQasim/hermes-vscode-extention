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
            expect(gemini.models.length).toBeGreaterThanOrEqual(20);
            expect(gemini.models.some(m => m.id === 'gemini-3.5-flash-lite')).toBe(true);
            expect(gemini.models.some(m => m.id === 'gemini-3.8-flash')).toBe(true);
            expect(gemini.models.some(m => m.id === 'gemini-4-neon')).toBe(true);
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

    it('should resolve model context ceiling across 4-tier pipeline', async () => {
        // Tier 1: Live ACP Wire value takes precedence
        const tier1 = await service.resolveModelContextCeiling('gemini-2.5-flash', 'gemini', 65536);
        expect(tier1).toBe(65536);

        // Tier 2: Hermes Authoritative Cache
        const tier2 = await service.resolveModelContextCeiling('gemini-2.5-pro', 'gemini');
        expect(tier2).toBeGreaterThanOrEqual(128000);

        // Tier 4: Heuristics fallback
        const geminiHeuristic = await service.resolveModelContextCeiling('gemini-1.5-pro-unknown-custom');
        expect(geminiHeuristic).toBe(1048576);

        const claudeHeuristic = await service.resolveModelContextCeiling('anthropic/claude-3-7-sonnet-custom');
        expect(claudeHeuristic).toBe(200000);

        const defaultBaseline = await service.resolveModelContextCeiling('completely-unknown-custom-model-xyz');
        expect(defaultBaseline).toBe(128000);
    });

    it('should populate reasoning and contextLimit attributes in model items', async () => {
        const config = await service.getModelConfig();
        const gemini = config.providers.find(p => p.id === 'gemini');
        expect(gemini).toBeDefined();
        if (gemini && gemini.models.length > 0) {
            const firstModel = gemini.models[0];
            expect(typeof firstModel.id).toBe('string');
            expect(typeof firstModel.contextLimit).toBe('number');
            expect(firstModel.contextLimit).toBeGreaterThan(0);
        }
    });

    it('should dynamically discover cached providers such as opencode-free and copilot-acp', async () => {
        const config = await service.getModelConfig();
        expect(config.providers.length).toBeGreaterThanOrEqual(FALLBACK_PROVIDERS.length);
        const opencode = config.providers.find(p => p.id === 'opencode-free');
        if (opencode) {
            expect(opencode.models.length).toBeGreaterThan(0);
            expect(opencode.hasKey).toBe(true);
        }
    });
});
