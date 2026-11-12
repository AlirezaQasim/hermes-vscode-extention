<script>
    import { onMount, onDestroy } from 'svelte';
    import { sendUserPrompt, cancelStreaming, isStreaming, startNewSession, clearMessages } from '../../state/chatStore';
    import { modelConfigStore } from '../../state/modelStore';
    import { activeTab, isConnected, postToHost, showToast } from '../../state/uiStore';
    import { t } from '../../i18n';
    import CommandPalette from './CommandPalette.svelte';

    let inputText = '';
    let textareaElement;
    let isPaletteOpen = false;
    let isFocused = false;
    let streamingSeconds = 0;
    let streamingInterval = null;

    $: currentModelName = $modelConfigStore?.current?.model || 'nemotron-3-ultra';
    $: cleanModel = currentModelName.split('/').pop()?.replace(/:free$/i, '') || currentModelName;

    $: if ($isStreaming) {
        if (!streamingInterval) {
            streamingSeconds = 0;
            streamingInterval = setInterval(() => {
                streamingSeconds++;
            }, 1000);
        }
    } else {
        if (streamingInterval) {
            clearInterval(streamingInterval);
            streamingInterval = null;
            streamingSeconds = 0;
        }
    }

    onDestroy(() => {
        if (streamingInterval) {
            clearInterval(streamingInterval);
        }
    });

    function formatTimer(secs) {
        const mins = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        return `${mins}:${s}`;
    }

    function handleInput() {
        if (inputText.startsWith('/')) {
            isPaletteOpen = true;
        } else {
            isPaletteOpen = false;
        }

        if (textareaElement) {
            textareaElement.style.height = 'auto';
            textareaElement.style.height = `${Math.min(textareaElement.scrollHeight, 140)}px`;
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if ($isStreaming) {
                cancelStreaming();
            } else {
                submitPrompt();
            }
        } else if (e.key === 'Escape') {
            isPaletteOpen = false;
        }
    }

    function submitPrompt() {
        if (!inputText.trim() || $isStreaming) return;
        const text = inputText.trim();
        inputText = '';
        if (textareaElement) {
            textareaElement.style.height = 'auto';
        }
        isPaletteOpen = false;
        sendUserPrompt(text);
    }

    function handleActionClick() {
        if ($isStreaming) {
            cancelStreaming();
        } else {
            submitPrompt();
        }
    }

    function openModelPicker() {
        $activeTab = 'models';
    }

    function handleNewChat() {
        startNewSession();
        showToast('گفتگوی جدید آغاز شد');
    }

    function handleClearChat() {
        clearMessages();
        showToast('سابقه گفتگو پاکسازی شد');
    }
</script>

<div id="command-capsule-wrapper" class="command-capsule-wrapper">
    <CommandPalette isOpen={isPaletteOpen} on:close={() => isPaletteOpen = false} />

    <div class="command-capsule {isFocused ? 'focused' : ''} {isPaletteOpen ? 'command-mode' : ''}" id="command-capsule">
        <!-- Input Row -->
        <div class="capsule-input-row">
            <button 
                type="button" 
                class="capsule-slash-tag" 
                id="btn-trigger-slash" 
                title="دستورات سریع (کلید /)"
                on:click={() => isPaletteOpen = !isPaletteOpen}
            >/</button>

            <textarea
                id="prompt-input"
                bind:this={textareaElement}
                bind:value={inputText}
                on:input={handleInput}
                on:keydown={handleKeyDown}
                on:focus={() => isFocused = true}
                on:blur={() => isFocused = false}
                placeholder={$isStreaming ? 'پیام بعدی‌تان را بنویسید...' : 'از هرمس بخواهید؛ بقیه‌اش با من.'}
                rows="1"
            ></textarea>

            <span class="capsule-hint" id="capsule-hint">دستور سریع با /</span>
        </div>

        <!-- Controls Row -->
        <div class="capsule-controls-row">
            <div class="capsule-left-tools">
                <button 
                    type="button" 
                    class="capsule-model-pill" 
                    id="capsule-model-pill" 
                    title="تغییر سریع مدل هوش مصنوعی"
                    on:click={openModelPicker}
                >
                    <span class="model-pill-icon">✨</span>
                    <span class="model-pill-name" id="capsule-model-name">{cleanModel}</span>
                    <span class="model-pill-arrow">▾</span>
                </button>

                <button 
                    type="button" 
                    class="capsule-tool-btn" 
                    id="btn-capsule-new" 
                    title="شروع گفتگوی جدید (New Chat)"
                    on:click={handleNewChat}
                >＋</button>

                <button 
                    type="button" 
                    class="capsule-tool-btn" 
                    id="btn-capsule-clear" 
                    title="پاک‌کردن سابقه گفتگو (Clear)"
                    on:click={handleClearChat}
                >🧹</button>
            </div>

            <div class="capsule-right-tools">
                {#if $isStreaming}
                    <span class="capsule-timer" id="capsule-timer">{formatTimer(streamingSeconds)}</span>
                {/if}
                <span class="capsule-enter-hint">Enter ↵</span>
                <button
                    type="button"
                    class="capsule-action-btn {$isStreaming ? 'streaming' : ''}"
                    id="btn-capsule-action"
                    title={$isStreaming ? 'توقف پاسخ (Stop)' : 'ارسال پیام (Enter)'}
                    on:click={handleActionClick}
                >
                    <span class="action-icon" id="capsule-action-icon">
                        {$isStreaming ? '■' : '↑'}
                    </span>
                </button>
            </div>
        </div>
    </div>

    <!-- Global Bottom Status Bar -->
    <footer class="capsule-footer-bar">
        <span class="footer-left" id="footer-left-status">
            {#if $isStreaming}
                Thinking · {streamingSeconds}s
            {:else}
                HERMES / v1.0.0
            {/if}
        </span>
        <span class="footer-center">محلی. مستقل. تحت کنترل شما.</span>
        <span class="footer-right" id="footer-right-status">
            <span class="footer-dot {$isConnected ? 'connected' : 'disconnected'}"></span>
            <span id="footer-right-text">{$isConnected ? 'Local CLI connected' : 'Disconnected'}</span>
        </span>
    </footer>
</div>
