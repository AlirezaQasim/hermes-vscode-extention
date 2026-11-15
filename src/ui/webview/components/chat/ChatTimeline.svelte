<script>
    import { onMount, afterUpdate } from 'svelte';
    import { messages, isStreaming } from '../../state/chatStore';
    import { activeTab, agentActivity } from '../../state/uiStore';

    let timelineContainer;
    let prevMessageCount = 0;
    let shouldAutoScroll = true;

    function handleScroll() {
        if (!timelineContainer) return;
        const distFromBottom = timelineContainer.scrollHeight - timelineContainer.scrollTop - timelineContainer.clientHeight;
        shouldAutoScroll = distFromBottom < 100;
    }

    function scrollToBottom(force = false) {
        if (timelineContainer && (force || shouldAutoScroll)) {
            requestAnimationFrame(() => {
                if (timelineContainer) {
                    timelineContainer.scrollTop = timelineContainer.scrollHeight;
                }
            });
        }
    }

    function isLastMsg(msg) {
        return $messages.length > 0 && $messages[$messages.length - 1]?.id === msg.id;
    }

    function renderMarkdown(content) {
        if (!content) return '';
        try {
            if (typeof marked !== 'undefined' && marked.parse) {
                return marked.parse(content);
            }
        } catch {
            // fallback
        }
        return escapeHtml(content).replace(/\n/g, '<br>');
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isLastWithTools(msg, allMessages) {
        if (!msg.toolCalls || msg.toolCalls.length === 0) return false;
        for (let i = allMessages.length - 1; i >= 0; i--) {
            if (allMessages[i].toolCalls && allMessages[i].toolCalls.length > 0) {
                return allMessages[i].id === msg.id;
            }
        }
        return false;
    }

    function isToolMessage(msg) {
        if (msg.role === 'tool') return true;
        if (typeof msg.content === 'string') {
            const trimmed = msg.content.trim();
            if (trimmed.startsWith('{"') && trimmed.endsWith('}') && (trimmed.includes('"exit_code"') || trimmed.includes('"bytes_written"') || trimmed.includes('"root_path"'))) {
                return true;
            }
        }
        return false;
    }

    function hasLearnedSkill(msg) {
        if (!msg) return false;
        if (msg.learnedSkill || msg.isSkillLearning) return true;
        if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
            return msg.toolCalls.some(tc => {
                if (tc.isSkill) return true;
                const name = (tc.name || tc.title || '').toLowerCase();
                return name.includes('skill') || name.includes('learn') || name.includes('teach') || name.includes('curator') || name.includes('memor');
            });
        }
        return false;
    }

    function isFailedTurn(msg) {
        if (msg.displayKind === 'failed_turn') return true;
        if (msg.errorMessage || msg.errorCode) return true;
        if (typeof msg.content === 'string') {
            const trimmed = msg.content.trim();
            if (trimmed.includes('Your request was not processed') || trimmed.includes('This turn did not complete')) {
                return true;
            }
        }
        return false;
    }

    function setupCodeBlocks() {
        if (!timelineContainer) return;
        if (typeof hljs !== 'undefined') {
            timelineContainer.querySelectorAll('pre code').forEach(block => {
                try { hljs.highlightElement(block); } catch (e) {}
            });
        }
        timelineContainer.querySelectorAll('pre').forEach(pre => {
            if (pre.closest('.code-block-wrapper')) return;
            const code = pre.querySelector('code');
            let lang = 'code';
            if (code) {
                const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
                if (langClass) lang = langClass.replace('language-', '');
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';
            const blockHeader = document.createElement('div');
            blockHeader.className = 'code-block-header';
            blockHeader.innerHTML = `<span>${escapeHtml(lang)}</span><button class="copy-button" type="button" title="Copy code">📋 Copy</button>`;

            const copyBtn = blockHeader.querySelector('.copy-button');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    const text = code ? code.innerText : pre.innerText;
                    navigator.clipboard.writeText(text).then(() => {
                        copyBtn.textContent = '✓ Copied';
                        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
                    });
                });
            }

            if (pre.parentNode) {
                pre.parentNode.insertBefore(wrapper, pre);
                wrapper.appendChild(blockHeader);
                wrapper.appendChild(pre);
            }
        });
    }

    afterUpdate(() => {
        if ($messages.length !== prevMessageCount) {
            const isNewUserMsg = $messages.length > 0 && $messages[$messages.length - 1].role === 'user';
            prevMessageCount = $messages.length;
            scrollToBottom(isNewUserMsg);
        }
        setupCodeBlocks();
    });

    onMount(() => {
        prevMessageCount = $messages.length;
        scrollToBottom(true);
        setupCodeBlocks();
    });
</script>

<div id="messages-container" class="messages-container" bind:this={timelineContainer} on:scroll={handleScroll}>
    {#each $messages as msg (msg.id)}
        {#if msg.role === 'user'}
            <div class="message role-user" data-id={msg.id}>
                <div class="user-bubble-header">
                    <span class="user-label">شما</span>
                </div>
                {#if msg.attachments && msg.attachments.length > 0}
                    <div class="message-attachments-row">
                        {#each msg.attachments as att}
                            <div class="message-attachment-pill">
                                {#if att.type === 'image'}
                                    <span class="attachment-icon">🖼️</span>
                                    {#if att.data}
                                        <img src="data:{att.mimeType || 'image/png'};base64,{att.data}" alt={att.name} class="attachment-thumb" />
                                    {/if}
                                {:else}
                                    <span class="attachment-icon">📄</span>
                                {/if}
                                <span class="attachment-name">{att.name}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
                <div class="user-bubble-content" dir="auto">
                    {@html renderMarkdown(msg.content)}
                </div>
            </div>
        {:else if isToolMessage(msg)}
            <!-- Clean Collapsible Tool Execution Result -->
            <div class="message role-tool" data-id={msg.id}>
                <details class="tool-output-details">
                    <summary class="tool-output-summary">
                        <span class="tool-icon">⚙️</span>
                        <span class="tool-summary-title">خروجی اجرای ابزار / Tool Result</span>
                    </summary>
                    <div class="tool-output-content">
                        <pre><code>{typeof msg.content === 'object' ? JSON.stringify(msg.content, null, 2) : msg.content}</code></pre>
                    </div>
                </details>
            </div>
        {:else if isFailedTurn(msg)}
            <!-- Failed turn notice styled as informative error card -->
            <div class="message role-failed-turn" data-id={msg.id}>
                <div class="failed-turn-banner">
                    <span class="failed-turn-icon">
                        {#if msg.errorCode === 'rate_limit' || (msg.errorMessage && msg.errorMessage.includes('429'))}
                            ⏳
                        {:else if msg.errorCode === 'auth_error' || (msg.errorMessage && (msg.errorMessage.includes('401') || msg.errorMessage.includes('auth')))}
                            🔑
                        {:else}
                            ⚠️
                        {/if}
                    </span>
                    <div class="failed-turn-body">
                        <div class="failed-turn-title">
                            {#if msg.errorCode === 'rate_limit' || (msg.errorMessage && msg.errorMessage.includes('429'))}
                                اتمام سهمیه روزانه یا محدودیت تعداد درخواست (Rate Limit 429)
                            {:else if msg.errorCode === 'auth_error' || (msg.errorMessage && (msg.errorMessage.includes('401') || msg.errorMessage.includes('auth')))}
                                خطای احراز هویت یا کلید API نامعتبر (401 Unauthorized)
                            {:else if msg.errorCode === 'geo_restriction' || (msg.errorMessage && msg.errorMessage.includes('403'))}
                                خطای محدودیت منطقه‌ای یا تحریم سرویس‌دهنده (403 Forbidden)
                            {:else if (msg.errorMessage && msg.errorMessage.includes('404'))}
                                مدل درخواستی یافت نشد (404 Model Not Found)
                            {:else}
                                پاسخ از سمت مدل هوش مصنوعی دریافت نشد
                            {/if}
                        </div>
                        <div class="failed-turn-desc">
                            {#if msg.errorCode === 'rate_limit' || (msg.errorMessage && msg.errorMessage.includes('429'))}
                                <div style="margin-bottom: 6px;">
                                    سهمیه درخواست‌های مدل فعلی در ارائه‌دهنده سرویس به اتمام رسیده است. برای ادامه گفتگو می‌توانید از تب مدل‌ها، مدل دیگری انتخاب کنید یا سشن جدیدی باز نمایید:
                                </div>
                            {:else if msg.errorCode === 'auth_error' || (msg.errorMessage && (msg.errorMessage.includes('401') || msg.errorMessage.includes('auth')))}
                                <div style="margin-bottom: 6px;">
                                    کلید API وارد شده معتبر نبوده یا اجازه دسترسی به این مدل را ندارد:
                                </div>
                            {:else}
                                <div style="margin-bottom: 6px;">
                                    ارتباط با مدل با خطا مواجه شد. پیام دریافتی از ایجنت و سرویس‌دهنده:
                                </div>
                            {/if}

                            {#if msg.errorMessage}
                                <div class="failed-turn-raw-error">
                                    <code>{msg.errorMessage}</code>
                                </div>
                            {:else if msg.content && msg.content !== 'Your request was not processed. Send it again if you still want me to carry it out.'}
                                <div class="failed-turn-raw-error">
                                    <code>{msg.content}</code>
                                </div>
                            {/if}
                        </div>
                        <div class="failed-turn-actions">
                            <button type="button" class="btn-change-model" on:click={() => $activeTab = 'models'}>
                                ⚙️ تغییر مدل در تنظیمات (انتخاب مدل دیگر)
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        {:else}
            <!-- Assistant message matching Figma Obsidian theme -->
            <div class="message role-assistant" data-id={msg.id}>
                <div class="assistant-header-row">
                    <div class="assistant-avatar">⚚</div>
                    <span class="assistant-name">هرمس</span>
                    <span class="assistant-status-badge">
                        {#if isLastMsg(msg) && $isStreaming}
                            {#if $agentActivity.state === 'thinking'}
                                در حال تفکر و تحلیل لحظه‌ای...
                            {:else if $agentActivity.state === 'writing_skill'}
                                در حال یادگیری و ثبت مهارت...
                            {:else if $agentActivity.state === 'tool'}
                                در حال اجرای ابزار...
                            {:else}
                                در حال پاسخ‌دهی...
                            {/if}
                        {:else}
                            پاسخ هوشمند
                        {/if}
                    </span>
                </div>

                <!-- 1. Live Thinking Block (Tokens Streamed in Milliseconds) -->
                {#if msg.thinking || (isLastMsg(msg) && $isStreaming && ($agentActivity.state === 'thinking' || !msg.content))}
                    <div class="thinking {isLastMsg(msg) && $isStreaming && $agentActivity.state === 'thinking' ? 'thinking-streaming' : ''}">
                        <details open>
                            <summary>
                                <span class="thinking-summary-title">💭 تفکر هوشمندانه / Thinking</span>
                                {#if isLastMsg(msg) && $isStreaming && $agentActivity.state === 'thinking'}
                                    <span class="thinking-live-badge">
                                        <span class="live-dot"></span>
                                        <span>در حال تحلیل آنی (Streaming...)</span>
                                    </span>
                                {/if}
                            </summary>
                            <div class="thinking-content" dir="auto">
                                {#if msg.thinking}
                                    {@html renderMarkdown(msg.thinking)}
                                    {#if isLastMsg(msg) && $isStreaming && $agentActivity.state === 'thinking'}
                                        <span class="cursor-typing">▌</span>
                                    {/if}
                                {:else}
                                    <div class="thinking-placeholder">
                                        <span class="spinning">↻</span>
                                        <span>هرمس در حال تفکر و ارزیابی عمیق است...</span>
                                    </div>
                                {/if}
                            </div>
                        </details>
                    </div>
                {/if}

                <!-- 2. Execution Timeline & Dedicated Live Skill Creation Card -->
                {#if msg.toolCalls && msg.toolCalls.length > 0}
                    <div class="execution-timeline-container">
                        {#each msg.toolCalls as tc}
                            {#if tc.isSkill}
                                <!-- Dedicated Real-Time Skill Writing Card on Screen -->
                                <div class="skill-creation-live-card {tc.status === 'done' ? 'card-done' : 'card-running'}">
                                    <div class="skill-creation-header">
                                        <span class="skill-icon">⚡</span>
                                        <div class="skill-info">
                                            <span class="skill-badge">یادگیری مهارت خودمختار (Skill Learning)</span>
                                            <h4 class="skill-title">{tc.skillName || tc.name}</h4>
                                        </div>
                                        <div class="skill-status-tag {tc.status === 'done' ? 'tag-done' : 'tag-running'}">
                                            {#if tc.status === 'done'}
                                                <span>✓ ثبت پایدار در SSD</span>
                                            {:else}
                                                <span class="spinning">↻</span>
                                                <span>در حال تدوین و ثبت مهارت...</span>
                                            {/if}
                                        </div>
                                    </div>
                                    {#if tc.args}
                                        <div class="skill-body-details">
                                            {typeof tc.args === 'string' ? tc.args : (tc.args.description || tc.args.prompt || JSON.stringify(tc.args))}
                                        </div>
                                    {/if}
                                </div>
                            {:else}
                                <div class="timeline-step {tc.status === 'done' ? 'step-done' : tc.status === 'running' ? 'step-running' : 'step-error'}">
                                    <div class="timeline-node">
                                        {#if tc.status === 'done'}
                                            ✓
                                        {:else if tc.status === 'running'}
                                            <span class="spinning">↻</span>
                                        {:else}
                                            ✕
                                        {/if}
                                    </div>
                                    <div class="timeline-body">
                                        <div class="timeline-title-row">
                                            <span class="step-title">{tc.title || tc.name || 'Tool Execution'}</span>
                                            <span class="step-status-badge {tc.status}">
                                                {tc.status === 'running' ? 'در حال اجرا...' : tc.status === 'done' ? '✓ تکمیل شد' : '✕ خطا'}
                                            </span>
                                        </div>
                                        {#if tc.arguments || tc.args}
                                            <div class="step-meta">
                                                {typeof (tc.arguments || tc.args) === 'string' ? (tc.arguments || tc.args) : JSON.stringify(tc.arguments || tc.args)}
                                            </div>
                                        {/if}
                                        {#if tc.result}
                                            <details class="tool-result-details">
                                                <summary class="tool-result-summary">مشاهده خروجی / Result</summary>
                                                <pre class="tool-result-pre"><code>{typeof tc.result === 'object' ? JSON.stringify(tc.result, null, 2) : tc.result}</code></pre>
                                            </details>
                                        {/if}
                                    </div>
                                </div>
                            {/if}
                        {/each}
                    </div>

                    <!-- Only show learned skill card when agent is actively learning or writing a skill -->
                    {#if isLastWithTools(msg, $messages)}
                        {#if hasLearnedSkill(msg) || (isLastMsg(msg) && $agentActivity.state === 'writing_skill')}
                            <div class="learned-skill-card">
                                <span class="learned-skill-icon">⚡</span>
                                <div class="learned-skill-body">
                                    <h4 class="learned-skill-title">از این پروژه یاد می‌گیرم</h4>
                                    <p class="learned-skill-desc">الگوهای معماری در حافظهٔ محلی ذخیره می‌شوند.</p>
                                </div>
                            </div>
                        {/if}

                        <div class="safety-guarantee-pill">
                            <span>🛡️ هیچ تغییری بدون تأیید شما اعمال نمی‌شود.</span>
                        </div>
                    {/if}
                {/if}

                <!-- 3. Assistant Output Content (Live Streamed Token-by-Token) -->
                {#if msg.content}
                    <div class="assistant-content" dir="auto">
                        {@html renderMarkdown(msg.content)}
                        {#if isLastMsg(msg) && $isStreaming && $agentActivity.state === 'streaming'}
                            <span class="cursor-typing">▌</span>
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    {/each}
</div>
