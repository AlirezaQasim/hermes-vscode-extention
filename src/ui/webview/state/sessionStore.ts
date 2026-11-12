import { writable } from 'svelte/store';
import type { HermesSession } from '../types';
import { postToHost, showToast } from './uiStore';
import { activeTab } from './uiStore';
import { t } from '../i18n';

export const sessionsList = writable<HermesSession[]>([]);
export const sessionFilter = writable<'active' | 'archived' | 'all'>('active');
export const sessionSearch = writable<string>('');

export function loadSession(sessionId: string): void {
    postToHost({ type: 'loadSession', sessionId });
    activeTab.set('chat');
}

export function toggleArchiveSession(sessionId: string, currentArchived: boolean): void {
    postToHost({ type: 'archiveSession', sessionId, archive: !currentArchived });
    sessionsList.update((list) =>
        list.map((s) => (s.id === sessionId ? { ...s, archived: !currentArchived } : s))
    );
    showToast(!currentArchived ? t('modal.archiveSession') : t('sessions.unarchive'));
}

export function deleteSession(sessionId: string): void {
    postToHost({ type: 'deleteSession', sessionId });
    sessionsList.update((list) => list.filter((s) => s.id !== sessionId));
    showToast(t('sessions.delete'));
}
