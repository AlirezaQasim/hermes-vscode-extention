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
    { id: 'gemini', name: 'Google AI Studio (Native Gemini API)', envVar: 'GOOGLE_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    { id: 'deepseek', name: 'DeepSeek (V3, R1, coder, direct API)', envVar: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com' },
    { id: 'xai', name: 'xAI Grok (Direct API)', envVar: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1' },
    { id: 'ollama', name: 'Ollama (Local Models at localhost:11434)', envVar: '', baseUrl: 'http://localhost:11434/v1' },
    { id: 'groq', name: 'Groq (Ultra-Fast Inference)', envVar: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1' }
];

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
                if (base === 'config.yaml' || base === '.env' || base === 'provider_models_cache.json') {
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
        const curProvider = modelSection['provider'] || 'openrouter';
        const curModel = modelSection['default'] || '';
        const curBaseUrl = modelSection['base_url'] || '';

        // Read provider cache if available
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
            const cachedModels = diskCachedProviders[pid]?.models;

            if (Array.isArray(cachedModels) && cachedModels.length > 0) {
                modelsList = cachedModels.map((mid: string) => ({
                    id: mid,
                    name: this.cleanModelName(mid),
                    tag: this.categorizeModel(mid)
                }));
            } else {
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
                models: modelsList.slice(0, 100)
            });
        }

        return {
            current: {
                provider: curProvider,
                model: curModel,
                baseUrl: curBaseUrl
            },
            providers: providersOut
        };
    }

    public async saveModelConfig(provider: string, model: string, apiKey?: string, baseUrl?: string): Promise<boolean> {
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

            if (baseUrl && baseUrl !== '-') {
                if (/^\s*base_url:\s*.*$/m.test(content)) {
                    content = content.replace(/^(\s*base_url:\s*).*$/m, `$1${baseUrl}`);
                } else {
                    content = content.replace(/^(\s*provider:\s*.*)$/m, `$1\n  base_url: ${baseUrl}`);
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
                    const pattern = new RegExp(`^#?\\s*${envVar}=.*$`, 'm');
                    const replacement = `${envVar}=${apiKey.trim()}`;
                    if (pattern.test(envContent)) {
                        envContent = envContent.replace(pattern, replacement);
                    } else {
                        envContent = envContent.trimEnd() + '\n' + replacement + '\n';
                    }
                    await fs.promises.writeFile(this.envPath, envContent, 'utf8');
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
        const name = modelId.split('/').pop() || modelId;
        const cleaned = name.replace(/:free$/i, '');
        const parts = cleaned.split(/[-_]/);
        return parts.map(p => {
            const lower = p.toLowerCase();
            if (['ai', 'gpt', 'api', 'moa', 'nim', 'ui', 'r1', 'v1', 'v2', 'v3', 'v4', 'pro', 'lite'].includes(lower) || /\d/.test(p)) {
                return p.toUpperCase();
            }
            return p.charAt(0).toUpperCase() + p.slice(1);
        }).join(' ') || modelId;
    }

    private categorizeModel(mid: string): string {
        const lower = mid.toLowerCase();
        if (lower.includes(':free')) return 'Free';
        if (lower.includes('sonnet') || lower.includes('gpt-4o') || lower.includes('deepseek-chat') || lower.includes('opus') || lower.includes('3.1-pro')) return 'Top Rated';
        if (lower.includes('haiku') || lower.includes('mini') || lower.includes('flash')) return 'Fast';
        if (lower.includes('r1') || lower.includes('o1') || lower.includes('o3') || lower.includes('reason')) return 'Reasoning';
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
