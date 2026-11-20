<script>
    import { onMount, onDestroy } from 'svelte';
    import { 
        sendUserPrompt, 
        cancelStreaming, 
        isStreaming, 
        startNewSession, 
        clearMessages, 
        attachmentsStore, 
        addAttachment, 
        removeAttachment, 
        pickAttachment, 
        projectFoldersStore, 
        currentCwdStore, 
        setCwd, 
        requestProjectFolders,
        tokenUsage,
        requestContextCompression 
    } from '../../state/chatStore';
    import { modelConfigStore, selectedReasoningEffort } from '../../state/modelStore';
    import { activeTab, isConnected, postToHost, showToast, voiceTranscriptStore, appVersion, openModal } from '../../state/uiStore';
    import { t } from '../../i18n';
    import CommandPalette from './CommandPalette.svelte';

    let inputText = '';
    let textareaElement;
    let isPaletteOpen = false;
    let isFocused = false;
    let isCwdDropdownOpen = false;
    let isDraggingOver = false;
    let isRecording = false;
    let recordingSeconds = 0;
    let recordingInterval = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let streamingSeconds = 0;
    let streamingInterval = null;

    $: currentModelName = $modelConfigStore?.current?.model || 'nemotron-3-ultra';
    $: cleanModel = currentModelName.split('/').pop()?.replace(/:free$/i, '') || currentModelName;

    function formatTokens(num) {
        if (!num || num <= 0) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(num);
    }

    $: contextTotal = $tokenUsage?.total || 0;
    $: contextMax = $tokenUsage?.maxContext || 128000;
    $: contextPercent = $tokenUsage?.percentUsed !== undefined ? $tokenUsage.percentUsed : (contextMax > 0 ? Math.min(100, Math.round((contextTotal / contextMax) * 1000) / 10) : 0);
    $: contextHealth = contextPercent >= 85 ? 'critical' : (contextPercent >= 70 ? 'warning' : 'healthy');
    $: contextIcon = contextPercent >= 85 ? '🚨' : (contextPercent >= 70 ? '⚠️' : '⚡');

    $: displayCwd = $currentCwdStore
        ? ($currentCwdStore.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'root')
        : 'workspace';

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

    // Automatically insert transcribed voice text into input prompt
    $: if ($voiceTranscriptStore) {
        const trText = $voiceTranscriptStore.text;
        if (trText) {
            if (inputText && inputText.trim()) {
                inputText = `${inputText.trim()} ${trText}`;
            } else {
                inputText = trText;
            }
            handleInput();
            voiceTranscriptStore.set(null);
        }
    }

    onMount(() => {
        requestProjectFolders();
        const closeMenus = (e) => {
            if (!e.target.closest('.capsule-cwd-pill') && !e.target.closest('.cwd-dropdown-menu')) {
                isCwdDropdownOpen = false;
            }
        };
        window.addEventListener('click', closeMenus);
        return () => window.removeEventListener('click', closeMenus);
    });

    onDestroy(() => {
        if (streamingInterval) {
            clearInterval(streamingInterval);
        }
        if (recordingInterval) {
            clearInterval(recordingInterval);
        }
    });

    function formatTimer(secs) {
        const mins = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        return `${mins}:${s}`;
    }

    function formatSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
            isCwdDropdownOpen = false;
        }
    }

    function handlePaste(e) {
        if (!e.clipboardData || !e.clipboardData.items) return;
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (!blob) continue;
                const reader = new FileReader();
                reader.onload = () => {
                    const dataUrl = reader.result;
                    const base64 = String(dataUrl).split(',')[1];
                    addAttachment({
                        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        name: `screenshot-${new Date().toLocaleTimeString().replace(/:/g, '-')}.png`,
                        type: 'image',
                        mimeType: blob.type || 'image/png',
                        size: blob.size,
                        data: base64
                    });
                    showToast('تصویر کلیپ‌بورد پیوست شد');
                };
                reader.readAsDataURL(blob);
                break;
            }
        }
    }

    function handleDragOver(e) {
        e.preventDefault();
        isDraggingOver = true;
    }

    function handleDragLeave() {
        isDraggingOver = false;
    }

    function handleDrop(e) {
        e.preventDefault();
        isDraggingOver = false;
        if (!e.dataTransfer || !e.dataTransfer.files) return;
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
            const isImg = file.type.startsWith('image/');
            const reader = new FileReader();
            reader.onload = () => {
                if (isImg) {
                    const base64 = String(reader.result).split(',')[1];
                    addAttachment({
                        id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        name: file.name,
                        type: 'image',
                        mimeType: file.type || 'image/png',
                        size: file.size,
                        data: base64
                    });
                } else {
                    addAttachment({
                        id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        name: file.name,
                        type: 'file',
                        size: file.size,
                        content: String(reader.result)
                    });
                }
                showToast(`فایل ${file.name} اضافه شد`);
            };
            if (isImg) {
                reader.readAsDataURL(file);
            } else {
                reader.readAsText(file);
            }
        }
    }

    function toggleVoiceRecording() {
        if (isRecording) {
            stopVoiceRecording();
            return;
        }

        isRecording = true;
        recordingSeconds = 0;
        if (recordingInterval) clearInterval(recordingInterval);
        recordingInterval = setInterval(() => {
            recordingSeconds++;
            if (recordingSeconds >= 90) {
                stopVoiceRecording();
            }
        }, 1000);

        postToHost({ type: 'startVoiceRecording' });
        showToast('🎙️ در حال ضبط صدا... برای اتمام دوباره کلیک کنید.');
    }

    function stopVoiceRecording() {
        if (!isRecording) return;
        isRecording = false;
        if (recordingInterval) {
            clearInterval(recordingInterval);
            recordingInterval = null;
        }
        recordingSeconds = 0;
        postToHost({ type: 'stopVoiceRecording' });
        showToast('⏳ در حال پردازش صوت...');
    }

    function submitPrompt() {
        if ((!inputText.trim() && $attachmentsStore.length === 0) || $isStreaming) return;
        const text = inputText.trim();
        inputText = '';
        if (textareaElement) {
            textareaElement.style.height = 'auto';
        }
        isPaletteOpen = false;
        sendUserPrompt(text, $attachmentsStore);
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

    function toggleCwdMenu(e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        isCwdDropdownOpen = !isCwdDropdownOpen;
        if (isCwdDropdownOpen) {
            requestProjectFolders();
        }
    }

    function selectFolder(fPath) {
        setCwd(fPath);
        isCwdDropdownOpen = false;
        showToast('پوشه کاری تغییر یافت');
    }

    function handleNewChat() {
        startNewSession();
        showToast('گفتگوی جدید آغاز شد');
    }

    function handleClearChat() {
        openModal({
            icon: '🧹',
            title: t('modal.confirmTitle'),
            message: t('modal.clearChat'),
            confirmLabel: t('modal.clearChatConfirm'),
            cancelLabel: t('modal.cancel'),
            onConfirm: () => {
                clearMessages();
                showToast(t('modal.clearChatSuccess'));
            }
        });
    }

    function handleQuickCompress() {
        openModal({
            icon: '🗜️',
            title: t('modal.compressTitle'),
            message: t('modal.compressMessage'),
            confirmLabel: t('modal.compressConfirm'),
            cancelLabel: t('modal.cancel'),
            onConfirm: () => {
                requestContextCompression();
                showToast(t('modal.compressingInProgress'));
            }
        });
    }
</script>

<div id="command-capsule-wrapper" class="command-capsule-wrapper">
    <CommandPalette isOpen={isPaletteOpen} on:close={() => isPaletteOpen = false} />

    <div 
        class="command-capsule {isFocused ? 'focused' : ''} {isPaletteOpen ? 'command-mode' : ''} {isDraggingOver ? 'drag-over' : ''}" 
        id="command-capsule"
        role="region"
        aria-label="Command Capsule"
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        on:drop={handleDrop}
    >
        <!-- Attachments Preview Row -->
        {#if $attachmentsStore.length > 0}
            <div class="capsule-attachments-bar">
                {#each $attachmentsStore as att (att.id)}
                    <div class="capsule-attachment-chip">
                        {#if att.type === 'image'}
                            {#if att.data}
                                <img src="data:{att.mimeType || 'image/png'};base64,{att.data}" alt={att.name} class="chip-thumb" />
                            {:else}
                                <span>🖼️</span>
                            {/if}
                        {:else if (att.mimeType && att.mimeType.startsWith('audio')) || att.name.endsWith('.wav')}
                            <span>🎙️</span>
                        {:else}
                            <span>📄</span>
                        {/if}
                        <span class="chip-name" title={att.name}>{att.name}</span>
                        {#if att.size}
                            <span class="chip-size">{formatSize(att.size)}</span>
                        {/if}
                        <button type="button" class="chip-remove-btn" on:click={() => removeAttachment(att.id)} title="حذف پیوست">✕</button>
                    </div>
                {/each}
            </div>
        {/if}

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
                on:paste={handlePaste}
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
                <!-- Model Switcher Pill -->
                <button 
                    type="button" 
                    class="capsule-model-pill" 
                    id="capsule-model-pill" 
                    title="تغییر سریع مدل هوش مصنوعی"
                    on:click={openModelPicker}
                >
                    <span class="model-pill-icon">🤖</span>
                    <span class="model-pill-name" id="capsule-model-name">{cleanModel}</span>
                    <span class="model-pill-arrow">▾</span>
                </button>

                <!-- Reasoning Effort Pill -->
                <button 
                    type="button" 
                    class="capsule-model-pill capsule-reasoning-pill" 
                    id="capsule-reasoning-pill" 
                    title="سطح تفکر و استدلال مدل: {$selectedReasoningEffort || 'high'} (کلیک برای تنظیمات)"
                    on:click={openModelPicker}
                >
                    <span class="model-pill-icon">🧠</span>
                    <span class="model-pill-name" id="capsule-reasoning-name">{$selectedReasoningEffort || 'high'}</span>
                </button>

                <!-- Context Window HUD & Smart Compaction Meter -->
                {#if contextTotal > 0}
                    <button 
                        type="button" 
                        class="capsule-model-pill capsule-context-pill {contextHealth}" 
                        id="capsule-context-pill" 
                        title="پنجره زمینه: {formatTokens(contextTotal)} / {formatTokens(contextMax)} ({contextPercent}% پر شده)&#10;ورودی: {formatTokens($tokenUsage?.prompt || 0)} | خروجی: {formatTokens($tokenUsage?.completion || 0)}"
                        on:click={handleQuickCompress}
                    >
                        <span class="model-pill-icon">{contextIcon}</span>
                        <span class="model-pill-name">{formatTokens(contextTotal)} / {formatTokens(contextMax)} ({contextPercent}%)</span>
                        {#if contextPercent >= 70}
                            <span class="compress-action-tag" title="فشرده‌سازی هوشمند">🗜️</span>
                        {/if}
                    </button>
                {/if}

                <!-- Visual CWD Selector Chip -->
                <div style="position: relative; display: inline-flex; flex-shrink: 0;">
                    <button 
                        type="button" 
                        class="capsule-cwd-pill" 
                        id="capsule-cwd-pill" 
                        title="انتخاب دایرکتوری کاری (CWD)"
                        on:click|stopPropagation={toggleCwdMenu}
                    >
                        <span>📁</span>
                        <span class="cwd-name">{displayCwd}</span>
                        <span>▾</span>
                    </button>

                    {#if isCwdDropdownOpen}
                        <div class="cwd-dropdown-menu" role="menu" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
                            {#if $projectFoldersStore.length === 0}
                                <div style="padding: 8px 10px; font-size: 11px; color: var(--hermes-text-muted);">
                                    در حال بارگذاری پوشه‌ها...
                                </div>
                            {:else}
                                {#each $projectFoldersStore as folder}
                                    <button 
                                        type="button" 
                                        class="cwd-dropdown-item {$currentCwdStore === folder.path ? 'active' : ''}"
                                        on:click={() => selectFolder(folder.path)}
                                    >
                                        <span>{folder.isRoot ? '🏠' : '📁'}</span>
                                        <span>{folder.name}</span>
                                        {#if $currentCwdStore === folder.path}
                                            <span style="margin-inline-start: auto; color: var(--hermes-gold);">✓</span>
                                        {/if}
                                    </button>
                                {/each}
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Plus Button for Adding Files / Attachments -->
                <button 
                    type="button" 
                    class="capsule-tool-btn capsule-attach-btn" 
                    id="btn-capsule-attach" 
                    title="افزودن فایل یا تصویر به گفتگو (Attach File/Image)"
                    on:click={pickAttachment}
                >＋</button>

                <!-- New Chat Button -->
                <button 
                    type="button" 
                    class="capsule-tool-btn capsule-new-chat-btn" 
                    id="btn-capsule-new" 
                    title="شروع گفتگوی تازه (New Chat)"
                    on:click={handleNewChat}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        <line x1="12" y1="8" x2="12" y2="14"></line>
                        <line x1="9" y1="11" x2="15" y2="11"></line>
                    </svg>
                </button>

                <!-- Clear Chat Button -->
                <button 
                    type="button" 
                    class="capsule-tool-btn" 
                    id="btn-capsule-clear" 
                    title="پاک‌کردن سابقه گفتگو (Clear)"
                    on:click={handleClearChat}
                >🧹</button>
            </div>

            <div class="capsule-right-tools">
                <!-- Voice Recording Indicator or Button -->
                {#if isRecording}
                    <div class="voice-recording-pill">
                        <span class="recording-dot"></span>
                        <span>{formatTimer(recordingSeconds)}</span>
                        <button type="button" on:click={stopVoiceRecording} style="background:none; border:none; color:#ef4444; cursor:pointer;" title="اتمام ضبط">■</button>
                    </div>
                {:else}
                    <button 
                        type="button" 
                        class="capsule-mic-btn" 
                        id="btn-capsule-mic" 
                        title="ورودی صوتی (Voice Note)"
                        on:click={toggleVoiceRecording}
                    >🎙️</button>
                {/if}

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
                HERMES / v{$appVersion}
            {/if}
        </span>
        <span class="footer-center">محلی. مستقل. تحت کنترل شما.</span>
        <span class="footer-right" id="footer-right-status">
            <span class="footer-dot {$isConnected ? 'connected' : 'disconnected'}"></span>
            <span id="footer-right-text">{$isConnected ? 'Local CLI connected' : 'Disconnected'}</span>
        </span>
    </footer>
</div>
