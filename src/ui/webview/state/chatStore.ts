import { writable, get } from 'svelte/store';
import type { ChatMessage, AttachmentItem, ProjectFolderItem, TokenUsageMetrics } from '../types';
import { postToHost } from './uiStore';

export const messages = writable<ChatMessage[]>([]);
export const currentSessionId = writable<string | null>(null);
export const sessionTitle = writable<string>('');
export const tokenUsage = writable<TokenUsageMetrics | null>(null);
export const isStreaming = writable<boolean>(false);
export const attachmentsStore = writable<AttachmentItem[]>([]);
export const projectFoldersStore = writable<ProjectFolderItem[]>([]);
export const currentCwdStore = writable<string>('');

export function sendUserPrompt(text: string, attachments?: AttachmentItem[]): void {
    if ((!text || !text.trim()) && (!attachments || attachments.length === 0)) return;
    isStreaming.set(true);
    if (attachments && attachments.length > 0) {
        postToHost({ type: 'sendPrompt', text: text.trim(), attachments });
    } else {
        postToHost({ type: 'sendPrompt', text: text.trim() });
    }
    attachmentsStore.set([]);
}

export function pickAttachment(): void {
    postToHost({ type: 'pickAttachment' });
}

export function requestProjectFolders(): void {
    postToHost({ type: 'getProjectFolders' });
}

export function setCwd(cwd: string): void {
    currentCwdStore.set(cwd);
    postToHost({ type: 'setCwd', cwd });
}

export function addAttachment(item: AttachmentItem): void {
    attachmentsStore.update(list => [...list, item]);
}

export function removeAttachment(id: string): void {
    attachmentsStore.update(list => list.filter(item => item.id !== id));
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
    attachmentsStore.set([]);
    postToHost({ type: 'newSession' });
}

export function clearMessages(): void {
    const sid = get(currentSessionId);
    messages.set([]);
    attachmentsStore.set([]);
    isStreaming.set(false);
    postToHost({ type: 'clearChat', sessionId: sid || undefined });
}

export function requestContextCompression(): void {
    postToHost({ type: 'compressContext' });
}
