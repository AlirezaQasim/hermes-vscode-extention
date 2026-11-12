<script>
    import { onMount } from 'svelte';
    import { activeTab, isConnected, autoApproveSetting, cwdSetting, agentActivity, modalStore, closeModal, toastStore, postToHost } from '../state/uiStore';
    import { messages, currentSessionId, sessionTitle, tokenUsage, isStreaming } from '../state/chatStore';
    import { sessionsList } from '../state/sessionStore';
    import { skillsList } from '../state/skillStore';
    import { modelConfigStore } from '../state/modelStore';
    import { locale, direction, t } from '../i18n';

    import HudNavbar from './hud/HudNavbar.svelte';
    import MissionHub from './chat/MissionHub.svelte';
    import ChatTimeline from './chat/ChatTimeline.svelte';
    import CommandCapsule from './chat/CommandCapsule.svelte';
    import SessionsPanel from './panels/SessionsPanel.svelte';
    import SkillsPanel from './panels/SkillsPanel.svelte';
    import ModelsPanel from './panels/ModelsPanel.svelte';

    onMount(() => {
        const handleMessage = (event) => {
            const data = event.data;
            if (!data) return;

            // Fast-path for live millisecond token streaming
            if (data.type === 'streamChunk') {
                $isStreaming = true;
                if (data.agentActivity) $agentActivity = data.agentActivity;
                messages.update((list) => {
                    let lastMsg = list[list.length - 1];
                    if (!lastMsg || lastMsg.role !== 'assistant') {
                        lastMsg = {
                            id: `msg-${Date.now()}`,
                            role: 'assistant',
                            content: '',
                            thinking: '',
                            timestamp: new Date()
                        };
                        list.push(lastMsg);
                    }
                    if (data.chunkType === 'thought') {
                        lastMsg.thinking = data.thinking !== undefined ? data.thinking : ((lastMsg.thinking || '') + (data.text || ''));
                    } else if (data.chunkType === 'content') {
                        lastMsg.content = data.content !== undefined ? data.content : ((lastMsg.content || '') + (data.text || ''));
                    }
                    return list;
                });
                return;
            }

            // Real-time tool execution / skill creation
            if (data.type === 'toolCall') {
                $isStreaming = true;
                if (data.agentActivity) $agentActivity = data.agentActivity;
                messages.update((list) => {
                    let lastMsg = list[list.length - 1];
                    if (!lastMsg || lastMsg.role !== 'assistant') {
                        lastMsg = {
                            id: `msg-${Date.now()}`,
                            role: 'assistant',
                            content: '',
                            thinking: '',
                            toolCalls: [],
                            timestamp: new Date()
                        };
                        list.push(lastMsg);
                    }
                    lastMsg.toolCalls = lastMsg.toolCalls || [];
                    lastMsg.toolCalls.push(data.toolCall);
                    return list;
                });
                return;
            }

            if (data.type === 'toolCallUpdate') {
                if (data.agentActivity) $agentActivity = data.agentActivity;
                messages.update((list) => {
                    let lastMsg = list[list.length - 1];
                    if (lastMsg && lastMsg.toolCalls) {
                        const tc = lastMsg.toolCalls.find((t) => t.id === data.update.id);
                        if (tc) {
                            tc.status = data.update.status || 'done';
                            tc.result = data.update.result;
                            tc.error = data.update.error;
                        }
                    }
                    return list;
                });
                return;
            }

            if (data.type === 'turnComplete') {
                $isStreaming = false;
                if (data.agentActivity) $agentActivity = data.agentActivity;
                else $agentActivity = { state: 'idle', label: 'Local CLI' };
                return;
            }

            if (data.type !== 'update') return;

            if (data.agentActivity) $agentActivity = data.agentActivity;
            if (data.activeTab) $activeTab = data.activeTab;
            if (data.connected !== undefined) $isConnected = data.connected;
            if (data.messages !== undefined) {
                $messages = data.messages;
                // If there's an active streaming chunk, stop streaming indicator when completed or failed
                const lastMsg = data.messages[data.messages.length - 1];
                if (lastMsg && (lastMsg.role === 'assistant' || lastMsg.role === 'tool' || lastMsg.displayKind === 'failed_turn')) {
                    if (!$agentActivity || $agentActivity.state === 'idle') {
                        $isStreaming = false;
                    }
                }
            }
            if (data.sessionId !== undefined) $currentSessionId = data.sessionId;
            if (data.sessionTitle !== undefined) $sessionTitle = data.sessionTitle;
            if (data.tokenUsage !== undefined) $tokenUsage = data.tokenUsage;
            if (data.modelConfig !== undefined) $modelConfigStore = data.modelConfig;
            if (data.sessions !== undefined) $sessionsList = data.sessions;
            if (data.skills !== undefined) $skillsList = data.skills;
            if (data.config) {
                $autoApproveSetting = data.config.autoApprove;
                $cwdSetting = data.config.cwd;
            }
        };

        window.addEventListener('message', handleMessage);

        // Tell host webview is loaded and ready
        postToHost({ type: 'refreshData' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    });

    function handleRunSetup() {
        postToHost({ type: 'runSetupTerminal' });
    }
</script>

<div id="app-container" lang={$locale} dir={$direction}>
    {#key $locale}
        <!-- Top Floating HUD Capsule Navbar -->
        <HudNavbar />

        <!-- Disconnected Alert Banner -->
        {#if !$isConnected && $activeTab === 'chat'}
            <div id="cli-disconnected-banner" class="cli-alert-banner">
                <div class="alert-content">
                    <div class="alert-info">
                        <h4 class="alert-title">{t('banner.title')}</h4>
                        <p class="alert-desc">{t('banner.desc')}</p>
                    </div>
                    <div class="alert-actions">
                        <code class="alert-code">hermes setup</code>
                        <button type="button" class="btn-banner-action" on:click={handleRunSetup}>
                            {t('banner.action')}
                        </button>
                    </div>
                </div>
            </div>
        {/if}

        <!-- Tab 1: Chat View -->
        <main id="tab-chat" class="tab-panel {$activeTab === 'chat' ? 'active' : ''}">
            {#if $messages.length === 0}
                <div id="messages-container" class="messages-container">
                    <MissionHub />
                </div>
            {:else}
                <ChatTimeline />
            {/if}
            <CommandCapsule />
        </main>

        <!-- Tab 2: Sessions Panel -->
        <main id="tab-sessions" class="tab-panel {$activeTab === 'sessions' ? 'active' : ''}">
            <SessionsPanel />
        </main>

        <!-- Tab 3: Skills Panel -->
        <main id="tab-skills" class="tab-panel {$activeTab === 'skills' ? 'active' : ''}">
            <SkillsPanel />
        </main>

        <!-- Tab 4: Models & Settings Panel -->
        <main id="tab-models" class="tab-panel {$activeTab === 'models' || $activeTab === 'settings' ? 'active' : ''}">
            <ModelsPanel />
        </main>

        <!-- Confirmation Modal Overlay -->
        {#if $modalStore.open}
            <div class="modal-overlay" on:click|self={closeModal} role="presentation">
                <div class="modal-card obsidian-card">
                    <div class="modal-header">
                        <span class="modal-icon">{$modalStore.icon || '⚠️'}</span>
                        <h4 class="modal-title">{$modalStore.title}</h4>
                    </div>
                    <div class="modal-body">
                        <p class="modal-message">{$modalStore.message}</p>
                        {#if $modalStore.callout}
                            <div class="modal-callout">{$modalStore.callout}</div>
                        {/if}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn-modal-cancel" on:click={closeModal}>
                            {$modalStore.cancelLabel || t('modal.cancel')}
                        </button>
                        <button 
                            type="button" 
                            class="btn-modal-confirm" 
                            on:click={() => {
                                if ($modalStore.onConfirm) $modalStore.onConfirm();
                                closeModal();
                            }}
                        >
                            {$modalStore.confirmLabel || t('modal.confirm')}
                        </button>
                    </div>
                </div>
            </div>
        {/if}

        <!-- Floating Toast Notification -->
        {#if $toastStore}
            <div class="toast-notification">
                {$toastStore}
            </div>
        {/if}
    {/key}
</div>
