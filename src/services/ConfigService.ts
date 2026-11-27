import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../utils/logger';
import { getHermesHome } from '../utils/hermesPaths';

export interface ModelItem {
    id: string;
    name: string;
    tag: string;
    reasoning?: boolean | undefined;
    reasoningEfforts?: string[] | undefined;
    reasoningMandatory?: boolean | undefined;
    contextLimit?: number | undefined;
}

export interface ModelProviderInfo {
    id: string;
    name: string;
    envVar: string;
    hasKey: boolean;
    keyStatus?: 'valid' | 'invalid' | 'missing' | 'oauth' | 'local' | 'unverified' | 'offline' | undefined;
    keyDetail?: string | undefined;
    keyMasked: string;
    baseUrl: string;
    docUrl: string;
    usageCount?: number | undefined;
    apiCallCount?: number | undefined;
    rank?: number | undefined;
    isTopPriority?: boolean | undefined;
    quota?: Record<string, any> | undefined;
    models: ModelItem[];
}

export interface ModelConfigData {
    current: {
        provider: string;
        model: string;
        baseUrl: string;
        reasoningEffort: string;
    };
    providers: ModelProviderInfo[];
    quota?: Record<string, any> | undefined;
    todayRequests?: number | undefined;
    syncTimestamp?: number | undefined;
    topLimit?: number | undefined;
    totalProviders?: number | undefined;
}

export const FALLBACK_PROVIDERS: Array<{ id: string; name: string; envVar: string; baseUrl: string }> = [
    { id: 'nous', name: 'Nous Portal (300+ models with bundled tool use)', envVar: 'NOUS_API_KEY', baseUrl: '' },
    { id: 'fireworks', name: 'Fireworks AI (OpenAI-compatible direct model API)', envVar: 'FIREWORKS_API_KEY', baseUrl: 'https://api.fireworks.ai/inference/v1' },
    { id: 'openrouter', name: 'OpenRouter (Pay-per-use API aggregator)', envVar: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1' },
    { id: 'moa', name: 'Mixture of Agents (named presets)', envVar: '', baseUrl: '' },
    { id: 'novita', name: 'NovitaAI (Cloud: Model API, Agent Sandbox)', envVar: 'NOVITA_API_KEY', baseUrl: 'https://api.novita.ai/v3/openai' },
    { id: 'lmstudio', name: 'LM Studio (Local desktop app with built-in model server)', envVar: 'LM_API_KEY', baseUrl: 'http://localhost:1234/v1' },
    { id: 'anthropic', name: 'Anthropic (Claude models via API key)', envVar: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com/v1' },
    { id: 'openai-codex', name: 'ChatGPT or Codex Subscription (Uses Codex models)', envVar: '', baseUrl: '' },
    { id: 'openai-api', name: 'OpenAI API (api.openai.com, API key)', envVar: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1' },
    { id: 'alibaba', name: 'Qwen Cloud / DashScope (Qwen + multi-provider)', envVar: 'DASHSCOPE_API_KEY', baseUrl: '' },
    { id: 'xai-oauth', name: 'xAI Grok OAuth (SuperGrok / Premium+ subscription)', envVar: '', baseUrl: '' },
    { id: 'nvidia', name: 'NVIDIA NIM (Nemotron models via build.nvidia.com)', envVar: 'NVIDIA_API_KEY', baseUrl: 'https://integrate.api.nvidia.com/v1' },
    { id: 'copilot', name: 'GitHub Copilot (Uses GITHUB_TOKEN or gh auth token)', envVar: 'GITHUB_TOKEN', baseUrl: '' },
    { id: 'gemini', name: 'Google AI Studio (Native Gemini API)', envVar: 'GOOGLE_API_KEY', baseUrl: '' },
    { id: 'deepseek', name: 'DeepSeek (V3, R1, coder, direct API)', envVar: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' },
    { id: 'xai', name: 'xAI Grok (Direct API)', envVar: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1' },
    { id: 'ollama', name: 'Ollama (Local Models at localhost:11434)', envVar: '', baseUrl: 'http://localhost:11434/v1' },
    { id: 'groq', name: 'Groq (Ultra-Fast Inference)', envVar: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1' }
];

// Mapping from Hermes provider names to models.dev registry IDs
const PROVIDER_TO_MODELS_DEV: Record<string, string> = {
    openrouter: 'openrouter',
    novita: 'novita-ai',
    anthropic: 'anthropic',
    openai: 'openai',
    'openai-api': 'openai',
    'openai-codex': 'openai',
    zai: 'zai',
    kimi: 'kimi-for-coding',
    'kimi-coding': 'kimi-for-coding',
    moonshot: 'kimi-for-coding',
    stepfun: 'stepfun',
    'kimi-coding-cn': 'kimi-for-coding',
    minimax: 'minimax',
    'minimax-oauth': 'minimax',
    'minimax-cn': 'minimax-cn',
    deepseek: 'deepseek',
    alibaba: 'alibaba',
    'qwen-oauth': 'alibaba',
    'ai-gateway': 'vercel',
    'opencode-zen': 'opencode',
    'opencode-go': 'opencode-go',
    kilocode: 'kilo',
    fireworks: 'fireworks-ai',
    huggingface: 'huggingface',
    gemini: 'google',
    google: 'google',
    xai: 'xai',
    'xai-oauth': 'xai',
    xiaomi: 'xiaomi',
    nvidia: 'nvidia',
    'meta-ai': 'meta',
    meta: 'meta',
    groq: 'groq',
    mistral: 'mistral',
    togetherai: 'togetherai',
    perplexity: 'perplexity',
    cohere: 'cohere',
    'ollama-cloud': 'ollama-cloud'
};

const NOISE_PATTERNS = /-tts\b|embedding|live-|-(preview|exp)-\d{2,4}[-_]|-image\b|-image-preview\b|-customtools\b/i;

const GOOGLE_HIDDEN_MODELS = new Set([
    'gemma-4-31b-it', 'gemma-4-26b-it', 'gemma-4-26b-a4b-it',
    'gemma-3-1b', 'gemma-3-1b-it', 'gemma-3-2b', 'gemma-3-2b-it',
    'gemma-3-4b', 'gemma-3-4b-it', 'gemma-3-12b', 'gemma-3-12b-it',
    'gemma-3-27b', 'gemma-3-27b-it',
    'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash-8b',
    'gemini-2.0-flash', 'gemini-2.0-flash-lite'
]);

const CURATED_STATIC_MODELS: Record<string, string[]> = {
    openrouter: [
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'nvidia/nemotron-3.5-lightning:free',
        'google/gemma-4-31b-it:free',
        'google/gemma-4-26b-a4b-it:free',
        'thinkingmachines/inkling:free',
        'thinkingmachines/inkling-2-small:free',
        'minimax/minimax-m3:free',
        'z-ai/glm-5.2:free',
        'poolside/laguna-s-2.1:free',
        'poolside/laguna-xs-2.1:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        'nvidia/nemotron-3.5-super-vl:free',
        'dots-studio/dots-3-note-preview:free',
        'cohere/north-mini-code:free',
        'recursive/flint-v1.0:free',
        'particle-ai/particle-1:free',
        'baidu/ernie-5.5-flash-preview:free',
        'liquid/lfm-3-1.7b:free',
        'inclusionai/ling-3.0-flash:free',
        'stealth/union-alpha',
        'stealth/space-bunny-alpha',
        'anthropic/claude-fable-5.2',
        'anthropic/claude-fable-5.1',
        'anthropic/claude-fable-5',
        'anthropic/claude-opus-5.5',
        'anthropic/claude-opus-5',
        'anthropic/claude-sonnet-5.5',
        'anthropic/claude-sonnet-5',
        'openai/gpt-6-astra',
        'openai/gpt-6.1-sol',
        'openai/gpt-6-luna',
        'openai/gpt-5.5',
        'google/gemini-4-argon',
        'deepseek/deepseek-v4-pro',
        'deepseek/deepseek-v4.1-flash',
        'qwen/qwen3.8-max-0902',
        'moonshotai/kimi-k3',
        'z-ai/glm-5.3'
    ],
    gemini: [
        'gemini-3.8-flash', 'gemini-4-neon', 'gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-4-argon', 'gemini-3.7-flash',
        'gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3.6-flash', 'gemini-3.1-flash-lite-preview', 'gemma-4-31b-it'
    ],
    anthropic: [
        'claude-fable-5-2', 'claude-fable-5.1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5',
        'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929', 'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'
    ],
    deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
    zai: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5v-turbo', 'glm-5-turbo', 'glm-4.7', 'glm-4.5', 'glm-4.5-flash'],
    nvidia: [
        'nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b',
        'nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        'z-ai/glm-5.3', 'z-ai/glm-5.2', 'moonshotai/kimi-k2.6', 'minimaxai/minimax-m3'
    ]
};

export class ConfigService extends EventEmitter {
    private logger: Logger;
    private hermesHome: string;
    private configPath: string;
    private envPath: string;
    private fileWatcher: fs.FSWatcher | null = null;
    private debounceTimer: NodeJS.Timeout | null = null;
    private lastSyncedCatalog: ModelConfigData | null = null;

    constructor(logger: Logger) {
        super();
        this.logger = logger;
        this.hermesHome = getHermesHome();
        this.configPath = path.join(this.hermesHome, 'config.yaml');
        this.envPath = path.join(this.hermesHome, '.env');
        this.startFileWatcher();
    }

    public startFileWatcher(): void {
        try {
            if (!fs.existsSync(this.hermesHome)) {
                this.logger.debug(`Hermes home does not exist yet: ${this.hermesHome}`);
                return;
            }

            this.fileWatcher = fs.watch(this.hermesHome, (eventType, filename) => {
                if (!filename) return;
                const base = filename.toString().toLowerCase();
                if (base === 'config.yaml' || base === '.env' || base === 'provider_models_cache.json' || base === 'models_dev_cache.json') {
                    this.onFileChanged(filename.toString());
                }
            });

            this.fileWatcher.on('error', (err) => {
                this.logger.warn('Hermes config watcher encountered error:', err);
            });

            this.logger.info(`Started Hot-Reload FileWatcher on ${this.hermesHome}`);
        } catch (error) {
            this.logger.warn('Failed to start Hot-Reload FileWatcher:', error);
        }
    }

    private onFileChanged(filename: string): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        // 50ms debounce for atomic writes and manual editor saves
        this.debounceTimer = setTimeout(async () => {
            this.logger.info(`Detected external config update (${filename}). Hot-reloading settings...`);
            try {
                const config = await this.readConfig();
                const env = await this.readEnv();
                const modelConfig = await this.getModelConfig();
                this.emit('configChanged', { config, env, modelConfig, filename });
            } catch (err) {
                this.logger.error('Error during config hot-reload:', err);
            }
        }, 50);
    }

    public async readConfig(): Promise<Record<string, any>> {
        try {
            if (!fs.existsSync(this.configPath)) {
                return {};
            }
            const content = await fs.promises.readFile(this.configPath, 'utf8');
            return this.parseYaml(content) || {};
        } catch (error) {
            this.logger.error('Failed to read config.yaml', error);
            return {};
        }
    }

    public async readEnv(): Promise<Record<string, string>> {
        try {
            if (!fs.existsSync(this.envPath)) {
                return {};
            }
            const content = await fs.promises.readFile(this.envPath, 'utf8');
            const env: Record<string, string> = {};
            for (const line of content.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const idx = trimmed.indexOf('=');
                    if (idx > 0) {
                        const key = trimmed.slice(0, idx).trim();
                        let value = trimmed.slice(idx + 1).trim();
                        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                            value = value.slice(1, -1);
                        }
                        env[key] = value;
                    }
                }
            }
            return env;
        } catch (error) {
            this.logger.error('Failed to read .env', error);
            return {};
        }
    }

    public async getModelConfig(): Promise<ModelConfigData> {
        const envKeys = await this.readEnv();
        const config = await this.readConfig();

        const modelSection = config['model'] || {};
        const agentSection = config['agent'] || {};
        const curProvider = modelSection['provider'] || 'openrouter';
        const curModel = modelSection['default'] || '';
        const curBaseUrl = modelSection['base_url'] || '';
        const curReasoningEffort = agentSection['reasoning_effort'] || 'high';

        // 1. Read authoritative models.dev registry cache if available
        let modelsDevCache: Record<string, any> = {};
        const modelsDevFile = path.join(this.hermesHome, 'models_dev_cache.json');
        if (fs.existsSync(modelsDevFile)) {
            try {
                const devContent = await fs.promises.readFile(modelsDevFile, 'utf8');
                modelsDevCache = JSON.parse(devContent);
            } catch {
                // Ignore parse errors
            }
        }

        // 2. Read secondary provider cache if available
        let diskCachedProviders: Record<string, any> = {};
        const providerCacheFile = path.join(this.hermesHome, 'provider_models_cache.json');
        if (fs.existsSync(providerCacheFile)) {
            try {
                const cacheContent = await fs.promises.readFile(providerCacheFile, 'utf8');
                diskCachedProviders = JSON.parse(cacheContent);
            } catch {
                // Ignore parse errors
            }
        }

        const providerCandidates = new Map<string, { id: string; name: string; envVar: string; baseUrl: string }>();

        // 1. Initial known standard providers
        for (const p of FALLBACK_PROVIDERS) {
            providerCandidates.set(p.id, { ...p });
        }

        // 2. Discover providers from Hermes disk cache (provider_models_cache.json)
        for (const [pid] of Object.entries(diskCachedProviders)) {
            if (!providerCandidates.has(pid)) {
                let pName = pid;
                if (pid === 'opencode-free') pName = 'OpenCode Free (Community / Keyless)';
                else if (pid === 'copilot-acp') pName = 'GitHub Copilot ACP (Built-in LLM Gateway)';
                else pName = `${pid.charAt(0).toUpperCase() + pid.slice(1)} (Hermes Discovered)`;
                providerCandidates.set(pid, {
                    id: pid,
                    name: pName,
                    envVar: `${pid.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`,
                    baseUrl: ''
                });
            }
        }

        // 3. Ensure currently configured provider from config.yaml is included
        if (curProvider && !providerCandidates.has(curProvider)) {
            providerCandidates.set(curProvider, {
                id: curProvider,
                name: `${curProvider.toUpperCase()} (Custom / Config)`,
                envVar: `${curProvider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`,
                baseUrl: curBaseUrl || ''
            });
        }

        const providersOut: ModelProviderInfo[] = [];

        for (const p of providerCandidates.values()) {
            const pid = p.id;
            let envVar = p.envVar;
            if (pid === 'gemini' && !envKeys[envVar] && envKeys['GEMINI_API_KEY']) {
                envVar = 'GEMINI_API_KEY';
            }

            const rawKey = envVar ? (envKeys[envVar] || '') : '';
            const hasKey = Boolean(rawKey) || pid === 'ollama' || pid.includes('oauth') || pid === 'openai-codex' || pid === 'opencode-free' || pid === 'copilot-acp';
            const keyMasked = rawKey ? this.maskKey(rawKey) : (pid === 'ollama' ? 'Local' : (pid.includes('oauth') || pid === 'copilot-acp' ? 'OAuth / CLI' : (pid === 'opencode-free' ? 'Free / Keyless' : '')));

            let modelsList: ModelItem[] = [];

            // A. Check models.dev authoritative cache & reasoning_caps.json
            const reasoningCaps = this.readReasoningCaps();
            const mdevKey = PROVIDER_TO_MODELS_DEV[pid] || pid;
            const mdevProviderData = modelsDevCache[mdevKey];
            const rawModels = (mdevProviderData && typeof mdevProviderData === 'object' && mdevProviderData.models)
                ? (mdevProviderData.models as Record<string, any>)
                : {};

            const agenticIds = Object.entries(rawModels)
                .filter(([mid, entry]) => {
                    if (!entry || entry.tool_call !== true) return false;
                    if (NOISE_PATTERNS.test(mid)) return false;
                    if ((pid === 'gemini' || pid === 'google') && GOOGLE_HIDDEN_MODELS.has(mid.toLowerCase())) return false;
                    return true;
                })
                .map(([mid]) => mid);

            // B. Also merge cached models from diskCachedProviders (live from CLI)
            const diskCachedModels: string[] = Array.isArray(diskCachedProviders[pid]?.models)
                ? diskCachedProviders[pid].models
                : [];

            const curated = CURATED_STATIC_MODELS[pid] || [];
            const mergedMap = new Map<string, string>();
            // Merge in priority order: diskCachedModels (live from CLI), agenticIds from registry, curated fallback
            for (const mid of [...diskCachedModels, ...agenticIds, ...curated]) {
                const lk = mid.toLowerCase();
                if (!mergedMap.has(lk)) {
                    mergedMap.set(lk, mid);
                }
            }

            const resolvedIds = Array.from(mergedMap.values());
            if (resolvedIds.length > 0) {
                modelsList = resolvedIds.map((mid) => {
                    let rawEntry = rawModels[mid] || rawModels[mid.toLowerCase()];
                    if (!rawEntry) {
                        const parts = mid.split('/');
                        const p0 = parts[0];
                        const p1 = parts[1];
                        if (parts.length === 2 && p0 && p1 && modelsDevCache[p0]?.models?.[p1]) {
                            rawEntry = modelsDevCache[p0].models[p1];
                        }
                    }
                    const capEntry = reasoningCaps[mid] || reasoningCaps[mid.toLowerCase()];
                    let reasoning = rawEntry ? (rawEntry.reasoning === true) : undefined;
                    let reasoningEfforts: string[] | undefined = undefined;
                    let reasoningMandatory: boolean | undefined = undefined;
                    if (rawEntry && Array.isArray(rawEntry.reasoning_options)) {
                        const effortOpt = rawEntry.reasoning_options.find((o: any) => o && o.type === 'effort');
                        if (effortOpt && Array.isArray(effortOpt.values) && effortOpt.values.length > 0) {
                            reasoningEfforts = effortOpt.values;
                        }
                    }
                    if (capEntry && typeof capEntry === 'object') {
                        if (typeof capEntry.supports_reasoning === 'boolean') {
                            reasoning = capEntry.supports_reasoning;
                        }
                        if (Array.isArray(capEntry.supported_efforts) && capEntry.supported_efforts.length > 0) {
                            reasoningEfforts = capEntry.supported_efforts;
                        }
                        if (typeof capEntry.mandatory === 'boolean') {
                            reasoningMandatory = capEntry.mandatory;
                        }
                    }
                    const contextLimit = rawEntry?.limit?.context && typeof rawEntry.limit.context === 'number'
                        ? rawEntry.limit.context
                        : undefined;

                    return {
                        id: mid,
                        name: this.cleanModelName(mid),
                        tag: this.categorizeModel(mid),
                        reasoning,
                        reasoningEfforts,
                        reasoningMandatory,
                        contextLimit
                    };
                });
            }

            // C. Fallback to hardcoded curated default models if nothing was resolved
            if (modelsList.length === 0) {
                modelsList = this.getDefaultModelsForProvider(pid);
            }

            const isFallback = FALLBACK_PROVIDERS.some(f => f.id === pid);
            if (isFallback || modelsList.length > 0 || hasKey || pid === curProvider) {
                const keyStatus = rawKey
                    ? 'unverified'
                    : (pid === 'ollama' ? 'local' : (pid.includes('oauth') || pid === 'openai-codex' || pid === 'copilot-acp' ? 'oauth' : 'missing'));
                providersOut.push({
                    id: pid,
                    name: p.name,
                    envVar,
                    hasKey,
                    keyStatus,
                    keyMasked,
                    baseUrl: p.baseUrl,
                    docUrl: '',
                    models: modelsList.slice(0, 500)
                });
            }
        }

        // Prioritize active + configured providers into Top 20 while preserving all others cleanly
        providersOut.sort((a, b) => {
            const aCur = a.id === curProvider ? 1 : 0;
            const bCur = b.id === curProvider ? 1 : 0;
            if (aCur !== bCur) return bCur - aCur;
            const aKey = a.hasKey ? 1 : 0;
            const bKey = b.hasKey ? 1 : 0;
            if (aKey !== bKey) return bKey - aKey;
            return 0;
        });
        providersOut.forEach((p, idx) => {
            p.rank = idx + 1;
            p.isTopPriority = idx < 20;
        });

        return {
            current: {
                provider: curProvider,
                model: curModel,
                baseUrl: curBaseUrl,
                reasoningEffort: curReasoningEffort
            },
            providers: providersOut,
            topLimit: 20,
            totalProviders: providersOut.length
        };
    }

    public getLastSyncedCatalog(): ModelConfigData | null {
        return this.lastSyncedCatalog;
    }

    private readReasoningCaps(): Record<string, any> {
        const result: Record<string, any> = {};
        try {
            const rcPath = path.join(this.hermesHome, 'cache', 'reasoning_caps.json');
            if (!fs.existsSync(rcPath)) return result;
            const raw = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
            if (raw && typeof raw === 'object') {
                if (raw.models && typeof raw.models === 'object') {
                    Object.assign(result, raw.models);
                } else {
                    for (const val of Object.values<any>(raw)) {
                        if (val && typeof val === 'object' && val.caps && typeof val.caps === 'object') {
                            Object.assign(result, val.caps);
                        } else if (val && typeof val === 'object' && 'supports_reasoning' in val) {
                            Object.assign(result, raw);
                            break;
                        }
                    }
                }
            }
        } catch {
            // Ignore cache read error
        }
        return result;
    }

    /**
     * Full live synchronization: combines Hermes Python live probes (API keys, server catalogs,
     * Ollama/local reachability, DB usage ranking, account quotas) with live ACP session models.
     */
    public async syncCatalogWithHermes(
        sessionService: { syncLiveCatalog?: (hermesHome: string, forceRefresh?: boolean) => Promise<any> } | null,
        acpModels: any[] = [],
        forceRefresh: boolean = true
    ): Promise<ModelConfigData> {
        const baseline = await this.getModelConfig();
        let liveData: any = null;
        if (sessionService && typeof sessionService.syncLiveCatalog === 'function') {
            try {
                liveData = await sessionService.syncLiveCatalog(this.hermesHome, forceRefresh);
            } catch (err) {
                this.logger.warn('Live catalog Python sync failed, falling back to local catalog + ACP:', err);
            }
        }

        const mergedProviders = new Map<string, ModelProviderInfo>();
        for (const bp of baseline.providers) {
            mergedProviders.set(bp.id, { ...bp, models: [...bp.models] });
        }

        if (liveData && Array.isArray(liveData.providers)) {
            for (const lp of liveData.providers) {
                const baseP = mergedProviders.get(lp.id);
                const liveModels: ModelItem[] = Array.isArray(lp.models) ? lp.models : [];
                let combinedModels = liveModels;
                if (baseP && baseP.models.length > 0) {
                    const seenIds = new Set(liveModels.map(m => m.id.toLowerCase()));
                    combinedModels = [
                        ...liveModels.map(m => {
                            const prev = baseP.models.find(b => b.id.toLowerCase() === m.id.toLowerCase());
                            return prev ? { ...prev, ...m } : m;
                        }),
                        ...(liveModels.length === 0 ? baseP.models : baseP.models.filter(b => !seenIds.has(b.id.toLowerCase())).slice(0, 25))
                    ];
                }
                mergedProviders.set(lp.id, {
                    ...(baseP || {}),
                    ...lp,
                    models: combinedModels
                });
            }
        }

        // Overlay live ACP session availableModels onto their respective or current provider
        const curProviderId = (liveData?.current?.provider || baseline.current.provider || 'openrouter');
        if (Array.isArray(acpModels) && acpModels.length > 0) {
            for (const am of acpModels) {
                const mid = am?.modelId || am?.id;
                if (!mid) continue;
                const targetPid = am?.provider || curProviderId;
                const prov = mergedProviders.get(targetPid) || mergedProviders.get(curProviderId);
                if (prov) {
                    const existingIdx = prov.models.findIndex(m => m.id.toLowerCase() === String(mid).toLowerCase());
                    const prevModel = existingIdx >= 0 ? prov.models[existingIdx] : undefined;
                    const item: ModelItem = {
                        id: mid,
                        name: am?.name || this.cleanModelName(mid),
                        tag: prevModel ? prevModel.tag : 'ACP Live',
                        reasoning: typeof am?.reasoning === 'boolean' ? am.reasoning : prevModel?.reasoning,
                        reasoningEfforts: am?.reasoningEfforts || prevModel?.reasoningEfforts,
                        reasoningMandatory: am?.reasoningMandatory ?? prevModel?.reasoningMandatory,
                        contextLimit: am?.contextWindow || am?.contextLength || prevModel?.contextLimit
                    };
                    if (existingIdx >= 0 && prevModel) {
                        prov.models[existingIdx] = { ...prevModel, ...item };
                    } else {
                        prov.models.unshift(item);
                    }
                }
            }
        }

        // Respect Python ordering if present, otherwise sort cleanly; always mark Top 20 priority
        const orderedList: ModelProviderInfo[] = [];
        if (liveData && Array.isArray(liveData.providers)) {
            const added = new Set<string>();
            for (const lp of liveData.providers) {
                const p = mergedProviders.get(lp.id);
                if (p) {
                    orderedList.push(p);
                    added.add(lp.id);
                }
            }
            for (const [id, p] of mergedProviders.entries()) {
                if (!added.has(id)) orderedList.push(p);
            }
        } else {
            orderedList.push(...mergedProviders.values());
        }

        orderedList.forEach((p, idx) => {
            p.rank = idx + 1;
            p.isTopPriority = idx < 20;
        });

        const synced: ModelConfigData = {
            current: {
                provider: liveData?.current?.provider || baseline.current.provider,
                model: liveData?.current?.model || baseline.current.model,
                baseUrl: liveData?.current?.baseUrl ?? baseline.current.baseUrl,
                reasoningEffort: liveData?.current?.reasoningEffort || baseline.current.reasoningEffort
            },
            providers: orderedList,
            quota: liveData?.quota || undefined,
            todayRequests: liveData?.todayRequests ?? liveData?.quota?.todayRequests ?? 0,
            syncTimestamp: liveData?.syncTimestamp || Date.now(),
            topLimit: 20,
            totalProviders: orderedList.length
        };

        this.lastSyncedCatalog = synced;
        return synced;
    }

    /**
     * Resolves both context window limit AND the tier/source that supplied it.
     */
    public resolveModelContextWithSource(modelId: string, provider?: string, liveAcpSize?: number): { limit: number; source: string } {
        if (typeof liveAcpSize === 'number' && liveAcpSize > 0) {
            return { limit: liveAcpSize, source: 'ACP Live Session' };
        }
        const mid = (modelId || '').trim();
        if (mid && this.lastSyncedCatalog) {
            const pMatch = provider ? this.lastSyncedCatalog.providers.find(p => p.id === provider) : null;
            const searchPools = pMatch ? [pMatch, ...this.lastSyncedCatalog.providers] : this.lastSyncedCatalog.providers;
            for (const p of searchPools) {
                const mFound = p.models.find(m => m.id === mid || m.id.toLowerCase() === mid.toLowerCase());
                if (mFound?.contextLimit && mFound.contextLimit > 0) {
                    return { limit: mFound.contextLimit, source: 'Live Provider Catalog' };
                }
            }
        }
        const limit = this.resolveModelContextCeiling(modelId, provider, liveAcpSize);
        let source = 'Model Family Heuristic';
        try {
            const modelsDevFile = path.join(this.hermesHome, 'models_dev_cache.json');
            if (mid && fs.existsSync(modelsDevFile)) {
                const devData = JSON.parse(fs.readFileSync(modelsDevFile, 'utf8'));
                const provKey = provider ? (PROVIDER_TO_MODELS_DEV[provider] || provider) : null;
                const sp = provKey && devData[provKey] ? [devData[provKey]] : Object.values(devData);
                for (const p of sp) {
                    const mObj = p?.models?.[mid] || p?.models?.[mid.toLowerCase()];
                    if (mObj?.limit?.context === limit) {
                        source = 'Hermes models.dev Cache';
                        break;
                    }
                }
            }
            if (source === 'Model Family Heuristic' && mid) {
                const oFile = path.join(this.hermesHome, 'ollama_cloud_models_cache.json');
                if (fs.existsSync(oFile)) {
                    const oData = JSON.parse(fs.readFileSync(oFile, 'utf8'));
                    const om = oData?.[mid] || oData?.[mid.toLowerCase()];
                    if (om && (om.num_ctx === limit || om.context_length === limit)) {
                        source = 'Ollama Local Metadata';
                    }
                }
            }
        } catch {
            // Keep source label
        }
        return { limit, source };
    }

    /**
     * Resolves the maximum context window ceiling for a model using the 4-Tier Zero-Failure pipeline:
     * Tier 1: Live ACP Wire size if reported by the running session.
     * Tier 2: Hermes authoritative cache (models_dev_cache.json -> limit.context).
     * Tier 3: Ollama / Local metadata cache (ollama_cloud_models_cache.json -> num_ctx / context_length).
     * Tier 4: Family-Heuristic name matching + safe 128,000 baseline guardrail.
     */
    public resolveModelContextCeiling(modelId: string, provider?: string, liveAcpSize?: number): number {
        if (typeof liveAcpSize === 'number' && liveAcpSize > 0) {
            return liveAcpSize;
        }

        const mid = (modelId || '').trim();
        if (!mid) {
            return 128000;
        }

        // Tier 2: Check models_dev_cache.json
        try {
            const modelsDevFile = path.join(this.hermesHome, 'models_dev_cache.json');
            if (fs.existsSync(modelsDevFile)) {
                const devData = JSON.parse(fs.readFileSync(modelsDevFile, 'utf8'));
                const provKey = provider ? (PROVIDER_TO_MODELS_DEV[provider] || provider) : null;
                const searchProviders = provKey && devData[provKey] ? [devData[provKey]] : Object.values(devData);

                for (const p of searchProviders) {
                    if (p && typeof p === 'object' && p.models) {
                        const mObj = p.models[mid] || p.models[mid.toLowerCase()];
                        if (mObj?.limit?.context && typeof mObj.limit.context === 'number' && mObj.limit.context > 0) {
                            return mObj.limit.context;
                        }
                        for (const candidate of Object.values<any>(p.models)) {
                            if (candidate && (candidate.id === mid || candidate.canonical_model_id === mid)) {
                                if (candidate.limit?.context && typeof candidate.limit.context === 'number' && candidate.limit.context > 0) {
                                    return candidate.limit.context;
                                }
                            }
                        }
                    }
                }
            }
        } catch {
            // Ignore parse errors and fall through
        }

        // Tier 3: Ollama local metadata cache (ollama_cloud_models_cache.json)
        try {
            const ollamaCacheFile = path.join(this.hermesHome, 'ollama_cloud_models_cache.json');
            if (fs.existsSync(ollamaCacheFile)) {
                const oData = JSON.parse(fs.readFileSync(ollamaCacheFile, 'utf8'));
                if (oData && typeof oData === 'object') {
                    const oModel = oData[mid] || oData[mid.toLowerCase()];
                    if (oModel?.num_ctx && typeof oModel.num_ctx === 'number' && oModel.num_ctx > 0) {
                        return oModel.num_ctx;
                    }
                    if (oModel?.context_length && typeof oModel.context_length === 'number' && oModel.context_length > 0) {
                        return oModel.context_length;
                    }
                }
            }
        } catch {
            // Fall through
        }

        // Tier 4: Family-Heuristics Regex Matching
        const lower = mid.toLowerCase();
        if (lower.includes('gemini-1.5') || lower.includes('gemini-2') || lower.includes('gemini-3') || lower.includes('gemini-4') || lower.includes('argon') || lower.includes('neon')) {
            return 1048576; // 1M tokens
        }
        if (lower.includes('claude-3') || lower.includes('claude-4') || lower.includes('claude-5') || lower.includes('sonnet') || lower.includes('opus')) {
            return 200000; // 200k tokens
        }
        if (lower.includes('gpt-4o') || lower.includes('gpt-5') || lower.includes('gpt-6') || lower.includes('o1') || lower.includes('o3')) {
            return 128000;
        }
        if (lower.includes('nemotron') || lower.includes('deepseek') || lower.includes('qwen') || lower.includes('llama-3') || lower.includes('mistral-large')) {
            return 131072; // 128k tokens
        }
        if (lower.includes('mini') || lower.includes('nano') || lower.includes('small') || lower.includes('8b') || lower.includes('7b')) {
            return 32768; // 32k tokens
        }

        return 128000;
    }

    public async saveReasoningEffort(effort: string): Promise<boolean> {
        try {
            let content = '';
            if (fs.existsSync(this.configPath)) {
                content = await fs.promises.readFile(this.configPath, 'utf8');
            } else {
                content = "agent:\n  reasoning_effort: high\n";
            }

            if (/^\s*reasoning_effort:\s*.*$/m.test(content)) {
                content = content.replace(/^(\s*reasoning_effort:\s*).*$/m, `$1${effort}`);
            } else if (/^agent:\s*$/m.test(content)) {
                content = content.replace(/^(agent:\s*)$/m, `$1\n  reasoning_effort: ${effort}`);
            } else {
                content += `\nagent:\n  reasoning_effort: ${effort}\n`;
            }

            await fs.promises.writeFile(this.configPath, content, 'utf8');
            this.logger.info(`Updated reasoning_effort in config.yaml to '${effort}'`);
            return true;
        } catch (error) {
            this.logger.error('Failed to save reasoning_effort to config.yaml', error);
            return false;
        }
    }

    public async saveModelConfig(provider: string, model: string, apiKey?: string, baseUrl?: string, reasoningEffort?: string): Promise<boolean> {
        try {
            // 1. Update config.yaml
            let content = '';
            if (fs.existsSync(this.configPath)) {
                content = await fs.promises.readFile(this.configPath, 'utf8');
            } else {
                content = "model:\n  default: ''\n  provider: ''\n";
            }

            if (/^\s*default:\s*.*$/m.test(content)) {
                content = content.replace(/^(\s*default:\s*).*$/m, `$1'${model}'`);
            } else {
                content = content.replace(/^(model:\s*)$/m, `$1\n  default: '${model}'`);
            }

            if (/^\s*provider:\s*.*$/m.test(content)) {
                content = content.replace(/^(\s*provider:\s*).*$/m, `$1${provider}`);
            } else {
                content = content.replace(/^(model:\s*)$/m, `$1\n  provider: ${provider}`);
            }

            if (baseUrl && baseUrl !== '-' && baseUrl.trim() !== '') {
                if (/^\s*base_url:\s*.*$/m.test(content)) {
                    content = content.replace(/^(\s*base_url:\s*).*$/m, `$1${baseUrl.trim()}`);
                } else {
                    content = content.replace(/^(\s*provider:\s*.*)$/m, `$1\n  base_url: ${baseUrl.trim()}`);
                }
            } else {
                content = content.replace(/^\s*base_url:\s*.*$\r?\n?/m, '');
            }

            if (reasoningEffort && reasoningEffort !== '-') {
                if (/^\s*reasoning_effort:\s*.*$/m.test(content)) {
                    content = content.replace(/^(\s*reasoning_effort:\s*).*$/m, `$1${reasoningEffort}`);
                } else if (/^agent:\s*$/m.test(content)) {
                    content = content.replace(/^(agent:\s*)$/m, `$1\n  reasoning_effort: ${reasoningEffort}`);
                } else {
                    content += `\nagent:\n  reasoning_effort: ${reasoningEffort}\n`;
                }
            }

            await fs.promises.writeFile(this.configPath, content, 'utf8');

            // 2. Update .env if apiKey provided
            if (apiKey && apiKey !== '-' && !apiKey.includes('•')) {
                let envVar = '';
                if (provider === 'openrouter') envVar = 'OPENROUTER_API_KEY';
                else if (provider === 'gemini') envVar = 'GOOGLE_API_KEY';
                else if (provider === 'openai-api' || provider === 'openai') envVar = 'OPENAI_API_KEY';
                else if (provider === 'anthropic') envVar = 'ANTHROPIC_API_KEY';
                else if (provider === 'deepseek') envVar = 'DEEPSEEK_API_KEY';
                else if (provider === 'groq') envVar = 'GROQ_API_KEY';
                else {
                    const found = FALLBACK_PROVIDERS.find(f => f.id === provider);
                    envVar = found?.envVar || `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
                }

                if (envVar) {
                    let envContent = '';
                    if (fs.existsSync(this.envPath)) {
                        envContent = await fs.promises.readFile(this.envPath, 'utf8');
                    }
                    // Filter out ALL occurrences of this env variable (active or commented) to eliminate duplicates
                    const lines = envContent.split(/\r?\n/);
                    const varPattern = new RegExp(`^#?\\s*${envVar}\\s*=`, 'i');
                    const filteredLines = lines.filter(line => !varPattern.test(line.trim()));
                    filteredLines.push(`${envVar}=${apiKey.trim()}`);
                    await fs.promises.writeFile(this.envPath, filteredLines.join('\n') + '\n', 'utf8');
                }
            }

            this.logger.info(`Successfully saved model config: provider=${provider}, model=${model}`);
            return true;
        } catch (error) {
            this.logger.error('Failed to save model config in ConfigService:', error);
            return false;
        }
    }

    private maskKey(key: string): string {
        if (!key) return '';
        if (key.length <= 8) return '••••••••';
        return `${key.slice(0, 3)}••••••••${key.slice(-4)}`;
    }

    private cleanModelName(modelId: string): string {
        const vendor = modelId.includes('/') ? modelId.split('/')[0] : '';
        const rawName = modelId.split('/').pop() || modelId;
        const cleaned = rawName.replace(/:free$/i, '');
        const parts = cleaned.split(/[-_]/);
        const formattedName = parts.map(p => {
            const lower = p.toLowerCase();
            if (['ai', 'gpt', 'api', 'moa', 'nim', 'ui', 'r1', 'v1', 'v2', 'v3', 'v4', 'pro', 'lite', 'vl', '550b', '120b', '30b', '70b', '31b', '26b', 'a55b', 'a12b', 'a3b', 'a4b'].includes(lower) || /\d/.test(p)) {
                return p.toUpperCase();
            }
            return p.charAt(0).toUpperCase() + p.slice(1);
        }).join(' ') || rawName;

        if (vendor && !formattedName.toLowerCase().includes(vendor.toLowerCase().replace(/[-_]/g, ' '))) {
            const vendorFormatted = vendor.split(/[-_]/).map(v => v.charAt(0).toUpperCase() + v.slice(1)).join(' ');
            return `${vendorFormatted} ${formattedName}`;
        }
        return formattedName;
    }

    private categorizeModel(mid: string): string {
        const lower = mid.toLowerCase();
        if (lower.includes(':free') || lower.includes('free') || lower.includes('alpha')) return 'Free';
        if (lower.includes('sonnet') || lower.includes('gpt-4o') || lower.includes('deepseek-chat') || lower.includes('opus') || lower.includes('3.1-pro') || lower.includes('fable') || lower.includes('kimi-k3')) return 'Top Rated';
        if (lower.includes('haiku') || lower.includes('mini') || lower.includes('flash') || lower.includes('fast')) return 'Fast';
        if (lower.includes('r1') || lower.includes('o1') || lower.includes('o3') || lower.includes('reason') || lower.includes('thinking')) return 'Reasoning';
        return 'Catalog';
    }

    private getDefaultModelsForProvider(pid: string): Array<{ id: string; name: string; tag: string }> {
        if (pid === 'openrouter') {
            return [
                { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'NVIDIA Nemotron 3 Ultra (Free)', tag: 'Free' },
                { id: 'google/gemma-4-31b-it:free', name: 'Google Gemma 4 31B (Free)', tag: 'Free' },
                { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (Free)', tag: 'Free' },
                { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', tag: 'Top Rated' },
                { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', tag: 'Top Rated' },
                { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', tag: 'Top Rated' },
                { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', tag: 'Reasoning' }
            ];
        }
        if (pid === 'gemini') {
            return [
                { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', tag: 'Recommended' },
                { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', tag: 'Fast' },
                { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tag: 'Top Rated' },
                { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', tag: 'Fast' }
            ];
        }
        if (pid === 'anthropic') {
            return [
                { id: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet', tag: 'Top Rated' },
                { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', tag: 'Fast' }
            ];
        }
        if (pid === 'openai-api') {
            return [
                { id: 'gpt-4o', name: 'GPT-4o', tag: 'Top Rated' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tag: 'Fast' },
                { id: 'o3-mini', name: 'o3 Mini', tag: 'Reasoning' }
            ];
        }
        return [];
    }

    private parseYaml(content: string): Record<string, any> {
        const result: Record<string, any> = {};
        const lines = content.split(/\r?\n/);
        const stack: Array<{ indent: number; obj: Record<string, any> }> = [{ indent: -1, obj: result }];

        for (const rawLine of lines) {
            const line = rawLine.replace(/#.*$/, '');
            if (!line.trim()) continue;

            const indent = line.search(/\S/);
            const trimmed = line.trim();

            while (stack.length > 1 && stack[stack.length - 1] && indent <= (stack[stack.length - 1]?.indent ?? -1)) {
                stack.pop();
            }
            const current = stack[stack.length - 1]?.obj ?? result;

            const colonIdx = trimmed.indexOf(':');
            if (colonIdx !== -1) {
                const key = trimmed.slice(0, colonIdx).trim();
                const rawVal = trimmed.slice(colonIdx + 1).trim();

                if (rawVal === '') {
                    const nextObj: Record<string, any> = {};
                    current[key] = nextObj;
                    stack.push({ indent, obj: nextObj });
                } else {
                    current[key] = this.parseYamlValue(rawVal);
                }
            }
        }
        return result;
    }

    private parseYamlValue(value: string): any {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null' || value === '~') return null;
        if (/^-?\d+$/.test(value)) return parseInt(value, 10);
        if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            return value.slice(1, -1);
        }
        return value;
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.close();
            this.fileWatcher = null;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.removeAllListeners();
    }
}
