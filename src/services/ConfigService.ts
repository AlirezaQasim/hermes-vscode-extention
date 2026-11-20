import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../utils/logger';
import { getHermesHome } from '../utils/hermesPaths';

export interface ModelProviderInfo {
    id: string;
    name: string;
    envVar: string;
    hasKey: boolean;
    keyMasked: string;
    baseUrl: string;
    docUrl: string;
    models: Array<{
        id: string;
        name: string;
        tag: string;
    }>;
}

export interface ModelConfigData {
    current: {
        provider: string;
        model: string;
        baseUrl: string;
        reasoningEffort: string;
    };
    providers: ModelProviderInfo[];
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

        const providersOut: ModelProviderInfo[] = [];

        for (const p of FALLBACK_PROVIDERS) {
            const pid = p.id;
            let envVar = p.envVar;
            if (pid === 'gemini' && !envKeys[envVar] && envKeys['GEMINI_API_KEY']) {
                envVar = 'GEMINI_API_KEY';
            }

            const rawKey = envVar ? (envKeys[envVar] || '') : '';
            const hasKey = Boolean(rawKey) || pid === 'ollama' || pid.includes('oauth') || pid === 'openai-codex';
            const keyMasked = rawKey ? this.maskKey(rawKey) : (pid === 'ollama' ? 'Local' : (pid.includes('oauth') ? 'OAuth / CLI' : ''));

            let modelsList: Array<{ id: string; name: string; tag: string }> = [];

            // A. Check models.dev authoritative cache first
            const mdevKey = PROVIDER_TO_MODELS_DEV[pid] || pid;
            const mdevProviderData = modelsDevCache[mdevKey];
            if (mdevProviderData && typeof mdevProviderData === 'object' && mdevProviderData.models) {
                const rawModels = mdevProviderData.models as Record<string, any>;
                const agenticIds = Object.entries(rawModels)
                    .filter(([mid, entry]) => {
                        if (!entry || entry.tool_call !== true) return false;
                        if (NOISE_PATTERNS.test(mid)) return false;
                        if ((pid === 'gemini' || pid === 'google') && GOOGLE_HIDDEN_MODELS.has(mid.toLowerCase())) return false;
                        return true;
                    })
                    .map(([mid]) => mid);

                const curated = CURATED_STATIC_MODELS[pid] || [];
                const mergedMap = new Map<string, string>();
                for (const mid of [...curated, ...agenticIds]) {
                    const lk = mid.toLowerCase();
                    if (!mergedMap.has(lk)) {
                        mergedMap.set(lk, mid);
                    }
                }

                const resolvedIds = Array.from(mergedMap.values());
                if (resolvedIds.length > 0) {
                    modelsList = resolvedIds.map((mid) => ({
                        id: mid,
                        name: this.cleanModelName(mid),
                        tag: this.categorizeModel(mid)
                    }));
                }
            }

            // B. Fallback to secondary provider_models_cache.json if not resolved from models.dev
            if (modelsList.length === 0) {
                const cachedModels = diskCachedProviders[pid]?.models;
                if (Array.isArray(cachedModels) && cachedModels.length > 0) {
                    modelsList = cachedModels.map((mid: string) => ({
                        id: mid,
                        name: this.cleanModelName(mid),
                        tag: this.categorizeModel(mid)
                    }));
                }
            }

            // C. Fallback to hardcoded curated default models
            if (modelsList.length === 0) {
                modelsList = this.getDefaultModelsForProvider(pid);
            }

            providersOut.push({
                id: pid,
                name: p.name,
                envVar,
                hasKey,
                keyMasked,
                baseUrl: p.baseUrl,
                docUrl: '',
                models: modelsList.slice(0, 500)
            });
        }

        return {
            current: {
                provider: curProvider,
                model: curModel,
                baseUrl: curBaseUrl,
                reasoningEffort: curReasoningEffort
            },
            providers: providersOut
        };
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
