import { writable } from 'svelte/store';
import type { ChatMessage } from '../types';
import { postToHost } from './uiStore';

export const messages = writable<ChatMessage[]>([]);
export const currentSessionId = writable<string | null>(null);
export const sessionTitle = writable<string>('');
export const tokenUsage = writable<{ prompt: number; completion: number; total: number } | null>(null);
export const isStreaming = writable<boolean>(false);

export function sendUserPrompt(text: string): void {
    if (!text || !text.trim()) return;
    isStreaming.set(true);
    postToHost({ type: 'sendPrompt', text: text.trim() });
}

export function cancelStreaming(): void {
    isStreaming.set(false);
    postToHost({ type: 'cancelTurn' });
}

export function startNewSession(): void {
    messages.set([]);
    currentSessionId.set(null);
    sessionTitle.set('');
    isStreaming.set(false);
    postToHost({ type: 'newSession' });
}

export function clearMessages(): void {
    messages.set([]);
    postToHost({ type: 'clearChat' });
}
