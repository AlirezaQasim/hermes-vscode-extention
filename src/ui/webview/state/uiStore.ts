import { writable } from 'svelte/store';
import type { TabId, WebviewToHostMessage } from '../types';

declare function acquireVsCodeApi(): {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
};

// Acquire VS Code API singleton
let vsCodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;
try {
    if (typeof acquireVsCodeApi === 'function') {
        vsCodeApi = acquireVsCodeApi();
    }
} catch {
    // In standalone browser testing
}

export function postToHost(message: WebviewToHostMessage): void {
    if (vsCodeApi) {
        vsCodeApi.postMessage(message);
    } else {
        console.log('[Webview -> Host Mock]:', message);
    }
}

export const activeTab = writable<TabId>('chat');
export const isConnected = writable<boolean>(false);
export const autoApproveSetting = writable<boolean>(false);
export const cwdSetting = writable<string>('');

export interface AgentActivity {
    state: 'idle' | 'thinking' | 'streaming' | 'tool' | 'writing_skill';
    label: string;
    detail?: string;
}

export const agentActivity = writable<AgentActivity>({
    state: 'idle',
    label: 'Local CLI'
});

export interface ModalState {
    open: boolean;
    icon?: string;
    title: string;
    message: string;
    callout?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
}

export const modalStore = writable<ModalState>({
    open: false,
    title: '',
    message: ''
});

export function openModal(state: Omit<ModalState, 'open'>): void {
    modalStore.set({ ...state, open: true });
}

export function closeModal(): void {
    modalStore.update((s) => ({ ...s, open: false }));
}

export const toastStore = writable<string | null>(null);

let toastTimer: any = null;
export function showToast(message: string, duration: number = 2800): void {
    if (toastTimer) clearTimeout(toastTimer);
    toastStore.set(message);
    toastTimer = setTimeout(() => {
        toastStore.set(null);
    }, duration);
}
