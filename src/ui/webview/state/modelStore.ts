import { writable } from 'svelte/store';
import type { ModelConfigData } from '../types';
import { postToHost, showToast } from './uiStore';

export const modelConfigStore = writable<ModelConfigData | null>(null);
export const selectedProviderId = writable<string>('openrouter');
export const selectedModelId = writable<string>('');
export const customModelId = writable<string>('');
export const isCustomModel = writable<boolean>(false);
export const apiKeyInput = writable<string>('');
export const isKeyVisible = writable<boolean>(false);
export const baseUrlInput = writable<string>('');

export function applyModelConfig(provider: string, model: string, apiKey?: string, baseUrl?: string): void {
    postToHost({
        type: 'saveModelConfig',
        provider,
        model,
        apiKey: apiKey || '-',
        baseUrl: baseUrl || '-'
    });
    showToast('Saved model configuration. Starting new chat...');
}
