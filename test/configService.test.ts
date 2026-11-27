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

    it('should mark Top 20 priority providers and expose syncCatalogWithHermes with ACP merge', async () => {
        const config = await service.getModelConfig();
        const top20 = config.providers.filter(p => p.isTopPriority === true);
        expect(top20.length).toBeLessThanOrEqual(20);
        expect(top20.length).toBeGreaterThan(5);

        const mockSessionSvc = {
            syncLiveCatalog: async () => ({
                current: { provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet', baseUrl: '' },
                providers: [
                    {
                        id: 'openrouter',
                        name: 'OpenRouter Live',
                        envVar: 'OPENROUTER_API_KEY',
                        hasKey: true,
                        keyStatus: 'valid',
                        keyMasked: 'sk-o••••••••1234',
                        baseUrl: 'https://openrouter.ai/api/v1',
                        docUrl: '',
                        usageCount: 12,
                        models: [
                            { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', tag: 'Reasoning', reasoning: true, reasoningEfforts: ['low', 'medium', 'high'], contextLimit: 200000 }
                        ]
                    }
                ],
                quota: { provider: 'openrouter', requestsUsed: 2, requestsLimit: 50, requestsRemaining: 48 },
                todayRequests: 2
            })
        };

        const synced = await service.syncCatalogWithHermes(mockSessionSvc, [
            { modelId: 'acp/live-test-model', name: 'ACP Live Model', provider: 'openrouter', contextWindow: 256000, reasoning: true }
        ], true);

        expect(synced.quota?.requestsRemaining).toBe(48);
        const orProv = synced.providers.find(p => p.id === 'openrouter');
        expect(orProv?.keyStatus).toBe('valid');
        expect(orProv?.models.some(m => m.id === 'acp/live-test-model')).toBe(true);

        const ctxRes = service.resolveModelContextWithSource('acp/live-test-model', 'openrouter');
        expect(ctxRes.limit).toBe(256000);
        expect(ctxRes.source).toBe('Live Provider Catalog');
    });

    it('should preserve session in query_sessions after clear while deleting permanently on delete', () => {
        const { execFileSync } = require('child_process');
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const { getPythonExecutablePath } = require('../src/utils/hermesPaths');

        const tmpDb = path.join(os.tmpdir(), `hermes-test-${Date.now()}.db`);
        const pyScript = path.resolve(process.cwd(), 'src/utils/hermesDb.py');
        const pyCode = `
import sqlite3, importlib.util, json
spec = importlib.util.spec_from_file_location('hdb', r'''${pyScript}''')
hdb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hdb)
db = r'''${tmpDb}'''
conn = sqlite3.connect(db)
conn.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, user_id TEXT, model TEXT, cwd TEXT, title TEXT, started_at REAL, last_active REAL, end_time REAL, message_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, reasoning_tokens INTEGER, api_call_count INTEGER, transcript_revision INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, billing_provider TEXT, parent_session_id TEXT, last_activity_at REAL)')
conn.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, timestamp REAL, tool_calls TEXT)')
conn.execute("INSERT INTO sessions (id, source, model, cwd, title, started_at, last_active, message_count, input_tokens, output_tokens, api_call_count) VALUES ('sess-keep', 'cli', 'gpt-4o', '/tmp/ws', 'Keep Session', 1000.0, 2000.0, 2, 500, 100, 3)")
conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES ('sess-keep', 'user', 'hi', 1001.0), ('sess-keep', 'assistant', 'hello', 1002.0)")
conn.commit()
conn.close()
clr = hdb.do_clear_session_messages(db, 'sess-keep')
after_clr = hdb.query_sessions(db, 50)
usage = hdb.query_session_usage(db, 'sess-keep')
dlt = hdb.do_delete_session(db, 'sess-keep')
after_del = hdb.query_sessions(db, 50)
print(json.dumps({'clr': clr['success'], 'inListAfterClr': any(s['id']=='sess-keep' for s in after_clr), 'msgCountAfterClr': after_clr[0]['messageCount'], 'usageCalls': usage['apiCallCount'], 'dlt': dlt['success'], 'inListAfterDel': any(s['id']=='sess-keep' for s in after_del)}))
`;
        try {
            const out = execFileSync(getPythonExecutablePath(), ['-c', pyCode], { encoding: 'utf8' });
            const parsed = JSON.parse(out.trim().split(/\r?\n/).pop() || '{}');
            expect(parsed.clr).toBe(true);
            expect(parsed.inListAfterClr).toBe(true);
            expect(parsed.msgCountAfterClr).toBe(0);
            expect(parsed.usageCalls).toBe(0);
            expect(parsed.dlt).toBe(true);
            expect(parsed.inListAfterDel).toBe(false);
        } finally {
            try { fs.unlinkSync(tmpDb); } catch {}
        }
    });
});
