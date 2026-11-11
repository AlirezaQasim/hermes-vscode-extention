const vscode = acquireVsCodeApi();

// State
let activeTab = 'chat';
let messages = [];
let connected = false;
let sessionId = null;
let sessionTitle = null;
let tokenUsage = null;
let modelConfig = null;
let sessions = [];
let skills = [];
let appConfig = {};
let selectedProviderId = 'openrouter';
let selectedModelFilter = 'all';

// Generation / Streaming State
let isGenerating = false;
let generationTimerInterval = null;
let generationSeconds = 0;

// Listen for messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            if (message.activeTab) activeTab = message.activeTab;
            messages = message.messages || [];
            connected = message.connected;
            sessionId = message.sessionId;
            sessionTitle = message.sessionTitle || null;
            tokenUsage = message.tokenUsage;
            if (message.modelConfig) modelConfig = message.modelConfig;
            if (message.sessions) sessions = message.sessions;
            if (message.skills) skills = message.skills;
            if (message.config) appConfig = message.config;

            // Detect if last message is a running tool or unfinished turn
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && (lastMsg.role === 'tool' || (lastMsg.toolCalls && lastMsg.toolCalls.some(t => t.status === 'running')))) {
                setGenerating(true);
            } else if (isGenerating && lastMsg && lastMsg.role === 'assistant' && !lastMsg.thinking && !lastMsg.toolCalls) {
                setGenerating(false);
            }

            renderAll();
            break;
    }
});

function setGenerating(generating) {
    if (isGenerating === generating) return;
    isGenerating = generating;
    if (isGenerating) {
        generationSeconds = 0;
        clearInterval(generationTimerInterval);
        generationTimerInterval = setInterval(() => {
            generationSeconds++;
            const mins = String(Math.floor(generationSeconds / 60)).padStart(2, '0');
            const secs = String(generationSeconds % 60).padStart(2, '0');
            const timerEl = document.getElementById('capsule-timer');
            if (timerEl) {
                timerEl.textContent = `${mins}:${secs}`;
                timerEl.style.display = 'inline-block';
            }
            const statusLeft = document.getElementById('footer-left-status');
            if (statusLeft) statusLeft.textContent = `Thinking · ${generationSeconds}s`;
        }, 1000);
    } else {
        clearInterval(generationTimerInterval);
        const timerEl = document.getElementById('capsule-timer');
        if (timerEl) timerEl.style.display = 'none';
        const statusLeft = document.getElementById('footer-left-status');
        if (statusLeft) statusLeft.textContent = 'HERMES / v0.8';
    }
    renderComposer();
    renderNavbar();
}

function renderAll() {
    renderNavbar();
    renderChatHeader();
    renderComposer();

    switch (activeTab) {
        case 'chat':
            renderMessages();
            break;
        case 'sessions':
            renderSessions();
            break;
        case 'skills':
            renderSkills();
            break;
        case 'models':
            renderModels();
            renderSettings();
            break;
    }
}

// ==========================================================================
// Navigation & Tabs (Figma Style)
// ==========================================================================

function switchTab(tabId) {
    if (tabId === 'settings') tabId = 'models';
    activeTab = tabId;
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    vscode.postMessage({ type: 'switchTab', tab: tabId });
    renderAll();
}

function renderNavbar() {
    // Badges
    const sessBadge = document.getElementById('nav-sessions-count');
    if (sessBadge) sessBadge.textContent = sessions.length;

    const skillBadge = document.getElementById('nav-skills-count');
    if (skillBadge) skillBadge.textContent = skills.length;

    // Active tab
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === activeTab);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${activeTab}`);
    });

    // HUD Status Pill
    const hudPill = document.getElementById('hud-status-pill');
    const hudText = document.getElementById('hud-status-text');
    if (hudPill && hudText) {
        hudPill.classList.remove('connected', 'thinking', 'disconnected');
        if (isGenerating) {
            hudPill.classList.add('thinking');
            hudText.textContent = 'Thinking · Local';
        } else if (connected) {
            hudPill.classList.add('connected');
            hudText.textContent = 'Local CLI';
        } else {
            hudPill.classList.add('disconnected');
            hudText.textContent = 'CLI disconnected';
        }
    }

    // Disconnected Alert Banner (Figma Image 4)
    const banner = document.getElementById('cli-disconnected-banner');
    if (banner) {
        banner.style.display = (!connected && activeTab === 'chat') ? 'block' : 'none';
    }

    // In-capsule model pill
    const capsuleModel = document.getElementById('capsule-model-name');
    if (capsuleModel) {
        const cur = modelConfig?.current?.model || 'nemotron-3-ultra';
        capsuleModel.textContent = cur.split('/').pop().replace(/:free$/, '');
    }

    // Footer right text
    const footerRightText = document.getElementById('footer-right-text');
    const footerDot = document.querySelector('.footer-dot');
    if (footerRightText) {
        footerRightText.textContent = connected ? 'CLI connected' : 'Disconnected';
    }
    if (footerDot) {
        footerDot.style.backgroundColor = connected ? 'var(--hermes-emerald)' : 'var(--hermes-crimson)';
    }
}

// Setup navbar click listeners
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabId = tab.getAttribute('data-tab');
        if (tabId) switchTab(tabId);
    });
});

document.getElementById('hud-status-pill')?.addEventListener('click', () => {
    if (!connected) {
        vscode.postMessage({ type: 'reconnect' });
        showToast('↻ در حال تلاش برای اتصال به هرمس...', 'info');
    } else {
        switchTab('settings');
    }
});

// Setup banner button
document.getElementById('btn-banner-run-setup')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'runSetup' });
    showToast('⚙️ دستور hermes setup در ترمینال اجرا شد', 'info');
});

// ==========================================================================
// Chat Tab & Messages (Figma Image 2, 3)
// ==========================================================================

function renderChatHeader() {
    // Model badge
    const modelBadge = document.getElementById('header-model-badge');
    if (modelBadge) {
        const currentModel = modelConfig?.current?.model || 'nemotron-3-ultra';
        const shortName = currentModel.split('/').pop().replace(/:free$/, '');
        modelBadge.textContent = shortName;
        modelBadge.title = `Current Model: ${currentModel} (${modelConfig?.current?.provider || 'openrouter'})`;
        modelBadge.onclick = () => switchTab('models');
    }

    // Session badge
    const sessionBadge = document.getElementById('header-session-badge');
    if (sessionBadge) {
        if (sessionId) {
            sessionBadge.style.display = 'inline-block';
            sessionBadge.textContent = sessionTitle || sessionId.slice(0, 8);
            sessionBadge.title = `Session: ${sessionId} (Click to copy ID)`;
            sessionBadge.onclick = () => {
                navigator.clipboard.writeText(sessionId).then(() => {
                    const orig = sessionBadge.textContent;
                    sessionBadge.textContent = '✓ Copied';
                    showToast('✓ Session ID copied', 'info');
                    setTimeout(() => { sessionBadge.textContent = orig; }, 1500);
                });
            };
        } else {
            sessionBadge.style.display = 'none';
        }
    }

    // Token badge
    const tokenBadge = document.getElementById('header-token-badge');
    if (tokenBadge) {
        if (tokenUsage) {
            tokenBadge.style.display = 'inline-block';
            const count = tokenUsage.total || (tokenUsage.promptTokens + tokenUsage.completionTokens) || 0;
            tokenBadge.textContent = `${count} tokens`;
        } else {
            tokenBadge.style.display = 'none';
        }
    }
}

function renderMessages() {
    const container = document.getElementById('messages-container');
    if (!container) return;

    if (!messages || messages.length === 0) {
        // Figma Image 2: Astrolabe Mission Hub
        container.innerHTML = `
            <div class="mission-hub-screen">
                <div class="mission-top-banner">
                    <span class="mission-banner-sub">AUTONOMOUS BY DESIGN. LOCAL BY DEFAULT.</span>
                    <div class="mission-status-grid">
                        <span class="status-cell-left">CORE / 01</span>
                        <span class="status-cell-right">SYSTEM READY</span>
                    </div>
                </div>

                <!-- Astrolabe / Celestial Compass Dial -->
                <div class="astrolabe-dial-wrap">
                    <div class="astrolabe-dial">
                        <div class="dial-orbit-ring">
                            <div class="dial-orbit-planet"></div>
                        </div>
                        <div class="dial-ticks-ring"></div>
                        <div class="dial-inner-ring">
                            <div class="dial-core-emblem">⚚</div>
                        </div>
                    </div>
                    <div class="mission-core-label">HERMES MISSION CORE</div>
                </div>

                <div class="mission-headings">
                    <h2 class="mission-title">مأموریت بعدی‌تان چیست؟</h2>
                    <p class="mission-subtitle">یک مأموریت انتخاب کنید یا از هرمس بخواهید.</p>
                </div>

                <!-- Suggested Mission Cards (Figma Image 2) -->
                <div class="mission-cards-container">
                    <!-- Card 1: Project Intelligence -->
                    <div class="mission-card" data-prompt="معماری این پروژه را بررسی کن و برای بهینه‌سازی، یک نقشهٔ راه بده.">
                        <div class="card-top-row">
                            <span class="card-tag">PROJECT INTELLIGENCE</span>
                            <span class="card-icon-box">⊞</span>
                        </div>
                        <h3 class="card-title">معماری و تحلیل پروژه</h3>
                        <p class="card-desc">از ساختار کد تا نقشهٔ قدم بعدی.</p>
                        <span class="card-arrow-btn">←</span>
                    </div>

                    <!-- Card 2: Debug & Optimize -->
                    <div class="mission-card" data-prompt="ریشه خطاهای احتمالی، باگ‌ها و مشکلات عملکردی در این پروژه را پیدا و تحلیل کن.">
                        <div class="card-top-row">
                            <span class="card-tag">DEBUG & OPTIMIZE</span>
                            <span class="card-icon-box">⚡</span>
                        </div>
                        <h3 class="card-title">عیب‌یابی و بهینه‌سازی</h3>
                        <p class="card-desc">ریشهٔ خطا را پیدا کن؛ هوشمندانه حلش کن.</p>
                        <span class="card-arrow-btn">←</span>
                    </div>
                </div>

                <!-- Workspace Sub-bar -->
                <div class="mission-workspace-subbar">
                    <span class="subbar-pill workspace-pill">📁 hermes-workspace</span>
                    <span class="subbar-divider">|</span>
                    <span class="subbar-pill local-pill">🛡️ فقط روی دستگاه شما</span>
                </div>
            </div>
        `;

        container.querySelectorAll('.mission-card').forEach(card => {
            card.addEventListener('click', () => {
                const prompt = card.getAttribute('data-prompt');
                if (prompt) {
                    sendPromptText(prompt);
                }
            });
        });
        return;
    }

    // Populated conversation (Figma Image 3)
    container.innerHTML = messages.map(msg => renderMessage(msg)).join('');
    container.scrollTop = container.scrollHeight;

    // Syntax highlight
    if (typeof hljs !== 'undefined') {
        container.querySelectorAll('pre code').forEach(block => {
            try { hljs.highlightElement(block); } catch (e) {}
        });
    }

    // Wrap pre/code with copy buttons
    container.querySelectorAll('pre').forEach(pre => {
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
        blockHeader.innerHTML = `<span>${escapeHtml(lang)}</span><button class="copy-button" title="Copy code">📋 Copy</button>`;

        const copyBtn = blockHeader.querySelector('.copy-button');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const text = code ? code.innerText : pre.innerText;
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.textContent = '✓ Copied';
                    showToast('✓ Code copied to clipboard', 'success');
                    setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
                });
            });
        }

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(blockHeader);
        wrapper.appendChild(pre);
    });
}

function renderMessage(msg) {
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    if (msg.role === 'user') {
        let contentHtml = '';
        if (typeof marked !== 'undefined') {
            try { contentHtml = marked.parse(msg.content || ''); } catch { contentHtml = escapeHtml(msg.content || ''); }
        } else {
            contentHtml = escapeHtml(msg.content || '');
        }
        return `
            <div class="message role-user" data-id="${escapeHtml(msg.id || '')}">
                <div class="user-bubble-header">
                    <span class="user-label">شما</span>
                </div>
                <div class="user-bubble-content">${contentHtml}</div>
            </div>
        `;
    }

    // Assistant message (Figma Image 3)
    let contentHtml = '';
    if (msg.role === 'tool') {
        contentHtml = `<pre><code>${escapeHtml(typeof msg.content === 'object' ? JSON.stringify(msg.content, null, 2) : String(msg.content))}</code></pre>`;
    } else if (typeof marked !== 'undefined') {
        try { contentHtml = marked.parse(msg.content || ''); } catch { contentHtml = escapeHtml(msg.content || ''); }
    } else {
        contentHtml = escapeHtml(msg.content || '');
    }

    let thinkingHtml = '';
    if (msg.thinking) {
        const thinkingParsed = typeof marked !== 'undefined' ? marked.parse(msg.thinking) : escapeHtml(msg.thinking);
        thinkingHtml = `
            <div class="thinking">
                <details open>
                    <summary>💭 تفکر هوشمندانه / Thinking</summary>
                    <div class="thinking-content">${thinkingParsed}</div>
                </details>
            </div>
        `;
    }

    // Live Execution Timeline (Figma Image 3)
    let timelineHtml = '';
    if (msg.toolCalls && msg.toolCalls.length > 0) {
        const stepsHtml = msg.toolCalls.map(tc => renderTimelineStep(tc)).join('');
        timelineHtml = `
            <div class="execution-timeline-container">
                ${stepsHtml}
            </div>
            <div class="learned-skill-card">
                <span class="learned-skill-icon">⚡</span>
                <div class="learned-skill-body">
                    <h4 class="learned-skill-title">از این پروژه یاد می‌گیرم</h4>
                    <p class="learned-skill-desc">الگوهای معماری در حافظهٔ محلی ذخیره می‌شوند.</p>
                </div>
            </div>
            <div class="safety-guarantee-pill">
                <span>🛡️ هیچ تغییری بدون تأیید شما اعمال نمی‌شود.</span>
            </div>
        `;
    }

    return `
        <div class="message role-assistant" data-id="${escapeHtml(msg.id || '')}">
            <div class="assistant-header-row">
                <div class="assistant-avatar">⚚</div>
                <span class="assistant-name">هرمس</span>
                <span class="assistant-status-badge">در حال بررسی، قدم‌به‌قدم</span>
            </div>
            <div class="assistant-content">${contentHtml}</div>
            ${thinkingHtml}
            ${timelineHtml}
        </div>
    `;
}

function renderTimelineStep(tc) {
    const isDone = tc.status === 'done';
    const isError = tc.status === 'error';
    const isRunning = !isDone && !isError;

    const nodeIcon = isDone ? '✓' : isError ? '✗' : '>_';
    const stepClass = isDone ? 'step-done' : isError ? 'step-error' : 'step-running';
    const durationText = isDone ? (tc.duration ? `${tc.duration}s` : '0.4s') : (isRunning ? 'LIVE' : '');

    // Friendly Iranian title based on tool kind or name
    let friendlyTitle = tc.title;
    if (!friendlyTitle) {
        if (tc.name === 'read_directory') friendlyTitle = 'ساختار پروژه خوانده شد';
        else if (tc.name === 'read_file') friendlyTitle = 'وابستگی‌ها و فایل‌ها شناسایی شدند';
        else if (tc.name === 'run_command') friendlyTitle = 'دستور سیستم اجرا شد';
        else friendlyTitle = `ابزار ${tc.name || 'سیستم'} اجرا شد`;
    }

    let argsPreview = '';
    if (tc.args) {
        if (typeof tc.args === 'object') {
            const vals = Object.values(tc.args).filter(v => typeof v === 'string').join(' · ');
            argsPreview = `${tc.name || 'tool'} · ${vals || 'args'}`;
        } else {
            argsPreview = `${tc.name || 'tool'} · ${String(tc.args)}`;
        }
    } else {
        argsPreview = tc.name || 'tool';
    }

    return `
        <div class="timeline-step ${stepClass}">
            <div class="timeline-node"><span class="node-icon">${nodeIcon}</span></div>
            <div class="timeline-body">
                <div class="timeline-title-row">
                    <span class="step-title">${escapeHtml(friendlyTitle)}</span>
                    <span class="step-time">${durationText}</span>
                </div>
                <div class="step-meta">${escapeHtml(argsPreview)}</div>
            </div>
        </div>
    `;
}

// ==========================================================================
// Command Capsule & Interactions (Figma Image 2, 3, 4)
// ==========================================================================

function renderComposer() {
    const actionBtn = document.getElementById('btn-capsule-action');
    const actionIcon = document.getElementById('capsule-action-icon');
    const input = document.getElementById('prompt-input');

    if (actionBtn && actionIcon) {
        if (isGenerating) {
            actionBtn.classList.add('streaming');
            actionIcon.textContent = '⏹';
            actionBtn.title = 'توقف پاسخ (Stop)';
        } else {
            actionBtn.classList.remove('streaming');
            actionIcon.textContent = '↑';
            actionBtn.title = 'ارسال پیام (Enter)';
        }
    }

    if (input) {
        input.placeholder = isGenerating ? 'پیام بعدی‌تان را بنویسید...' : 'از هرمس بخواهید؛ بقیه‌اش با من.';
    }
}

function sendPromptText(text) {
    if (!text || !text.trim()) return;
    const input = document.getElementById('prompt-input');
    if (input) {
        input.value = '';
        input.style.height = 'auto';
    }
    setGenerating(true);
    vscode.postMessage({ type: 'sendPrompt', text: text.trim() });
}

function sendPrompt() {
    const input = document.getElementById('prompt-input');
    if (!input || !input.value.trim()) return;
    sendPromptText(input.value);
}

// Keyboard navigation and Command Mode (Image 4)
const promptInput = document.getElementById('prompt-input');
const commandPopup = document.getElementById('command-mode-popup');
const commandCapsule = document.getElementById('command-capsule');

if (promptInput) {
    promptInput.addEventListener('focus', () => {
        commandCapsule?.classList.add('focused');
    });
    promptInput.addEventListener('blur', () => {
        commandCapsule?.classList.remove('focused');
    });

    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';

        const val = promptInput.value.trim();
        if (val.startsWith('/')) {
            showCommandPopup();
        } else {
            hideCommandPopup();
        }
    });

    promptInput.addEventListener('keydown', e => {
        if (commandPopup && commandPopup.style.display !== 'none') {
            if (e.key === 'Escape') {
                e.preventDefault();
                hideCommandPopup();
                promptInput.value = '';
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                navigatePopup(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                navigatePopup(-1);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const activeItem = commandPopup.querySelector('.popup-item.active');
                if (activeItem) {
                    const cmd = activeItem.getAttribute('data-cmd');
                    executeCommand(cmd);
                }
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (isGenerating) {
                vscode.postMessage({ type: 'cancelTurn' });
                setGenerating(false);
            } else {
                sendPrompt();
            }
        }
    });
}

function showCommandPopup() {
    if (!commandPopup) return;
    commandPopup.style.display = 'block';
    commandCapsule?.classList.add('command-mode');
}

function hideCommandPopup() {
    if (!commandPopup) return;
    commandPopup.style.display = 'none';
    commandCapsule?.classList.remove('command-mode');
}

function navigatePopup(direction) {
    const items = Array.from(commandPopup.querySelectorAll('.popup-item'));
    if (items.length === 0) return;
    let idx = items.findIndex(el => el.classList.contains('active'));
    if (idx === -1) idx = 0;
    items[idx].classList.remove('active');
    idx = (idx + direction + items.length) % items.length;
    items[idx].classList.add('active');
    items[idx].scrollIntoView({ block: 'nearest' });
}

function executeCommand(cmd) {
    hideCommandPopup();
    if (promptInput) promptInput.value = '';

    switch (cmd) {
        case '/new':
            vscode.postMessage({ type: 'newSession' });
            showToast('✓ گفتگوی جدید آغاز شد', 'success');
            break;
        case '/model':
            toggleModelQuickPopover();
            break;
        case '/skills':
            switchTab('skills');
            break;
        case '/history':
            switchTab('sessions');
            break;
        case '/clear':
            vscode.postMessage({ type: 'clearHistory' });
            showToast('✓ گفت‌وگو پاک شد', 'info');
            break;
        case '/retry':
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            if (lastUserMsg && lastUserMsg.content) {
                vscode.postMessage({ type: 'sendMessage', text: lastUserMsg.content });
                showToast('↻ در حال ارسال مجدد آخرین پیام...', 'info');
            } else {
                showToast('پیامی برای ارسال مجدد وجود ندارد', 'warning');
            }
            break;
        case '/setup':
            vscode.postMessage({ type: 'runSetup' });
            showToast('⚙️ راه‌اندازی محلی اجرا شد', 'info');
            break;
    }
}

// Popup item clicks
document.querySelectorAll('#popup-command-items .popup-item').forEach(item => {
    item.addEventListener('click', () => {
        const cmd = item.getAttribute('data-cmd');
        if (cmd) executeCommand(cmd);
    });
});

// Slash chip click
document.getElementById('btn-trigger-slash')?.addEventListener('click', () => {
    if (promptInput) {
        promptInput.value = '/';
        promptInput.focus();
        showCommandPopup();
    }
});

// Action Button (Send / Stop)
document.getElementById('btn-capsule-action')?.addEventListener('click', () => {
    if (isGenerating) {
        vscode.postMessage({ type: 'cancelTurn' });
        setGenerating(false);
        showToast('⏹ فرآیند متوقف شد', 'info');
    } else {
        sendPrompt();
    }
});

// Capsule New & Clear buttons
document.getElementById('btn-capsule-new')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'newSession' });
    showToast('✓ گفتگوی جدید آغاز شد', 'success');
});

document.getElementById('btn-capsule-clear')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearHistory' });
    showToast('✓ گفت‌وگو پاک شد', 'info');
});

// ==========================================================================
// In-Capsule Quick Model Popover
// ==========================================================================

const quickModelsList = [
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'NVIDIA Nemotron 3 Ultra (Free)', provider: 'openrouter' },
    { id: 'nvidia/nemotron-3.5-lightning:free', name: 'NVIDIA Nemotron 3.5 Lightning (Free)', provider: 'openrouter' },
    { id: 'google/gemma-4-31b-it:free', name: 'Google Gemma 4 31B (Free)', provider: 'openrouter' },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek' },
    { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', provider: 'openai' }
];

function toggleModelQuickPopover() {
    const popover = document.getElementById('model-quick-popover');
    if (!popover) return;

    if (popover.style.display !== 'none') {
        popover.style.display = 'none';
        return;
    }

    const listEl = document.getElementById('popover-model-list');
    if (listEl) {
        const curModel = modelConfig?.current?.model || '';
        const curProvider = modelConfig?.current?.provider || 'openrouter';
        const activeProvObj = (modelConfig?.providers || []).find(p => p.id === curProvider);

        let modelsToShow = [];
        if (activeProvObj && activeProvObj.models && activeProvObj.models.length > 0) {
            modelsToShow = activeProvObj.models.slice(0, 12).map(m => ({
                id: m.id,
                name: m.name ? `${m.name}${m.tag ? ' [' + m.tag + ']' : ''}` : m.id,
                provider: curProvider
            }));
            if (curModel && !modelsToShow.some(m => m.id === curModel)) {
                modelsToShow.unshift({
                    id: curModel,
                    name: `${curModel} [Current]`,
                    provider: curProvider
                });
            }
        } else {
            modelsToShow = quickModelsList;
        }

        listEl.innerHTML = modelsToShow.map(m => {
            const isActive = m.id === curModel;
            return `
                <div class="popover-model-item ${isActive ? 'active' : ''}" data-model="${escapeHtml(m.id)}" data-provider="${escapeHtml(m.provider)}">
                    ${isActive ? '● ' : '○ '}${escapeHtml(m.name)}
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.popover-model-item').forEach(item => {
            item.addEventListener('click', () => {
                const model = item.getAttribute('data-model');
                const provider = item.getAttribute('data-provider');
                vscode.postMessage({
                    type: 'saveModelConfig',
                    provider: provider || curProvider,
                    model
                });
                showToast(`🚀 در حال تنظیم ${model}...`, 'info');
                popover.style.display = 'none';
            });
        });
    }

    popover.style.display = 'block';
}

document.getElementById('capsule-model-pill')?.addEventListener('click', toggleModelQuickPopover);
document.getElementById('btn-close-model-popover')?.addEventListener('click', () => {
    const popover = document.getElementById('model-quick-popover');
    if (popover) popover.style.display = 'none';
});
document.getElementById('btn-open-full-models-tab')?.addEventListener('click', () => {
    const popover = document.getElementById('model-quick-popover');
    if (popover) popover.style.display = 'none';
    switchTab('models');
});

// Toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('hermes-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast-notification toast-${type} show`;
    toast.style.display = 'flex';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { toast.style.display = 'none'; }, 250);
    }, 2800);
}

// Confirmation Modal System
let pendingModalAction = null;

function showConfirmationModal({ icon, title, message, calloutHtml, confirmText, confirmClass, onConfirm }) {
    const modal = document.getElementById('hermes-modal');
    if (!modal) return;
    
    const iconEl = document.getElementById('modal-icon');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const calloutEl = document.getElementById('modal-callout');
    const confirmBtn = document.getElementById('modal-btn-confirm');

    if (iconEl) iconEl.textContent = icon || '❓';
    if (titleEl) titleEl.textContent = title || 'تأیید عملیات';
    if (msgEl) msgEl.textContent = message || '';
    
    if (calloutEl) {
        calloutEl.innerHTML = calloutHtml || '';
        calloutEl.style.display = calloutHtml ? 'block' : 'none';
    }
    
    if (confirmBtn) {
        confirmBtn.textContent = confirmText || 'تأیید';
        confirmBtn.className = `btn-sm btn-modal-confirm ${confirmClass || ''}`;
    }
    
    pendingModalAction = onConfirm;
    modal.style.display = 'flex';
}

function hideConfirmationModal() {
    const modal = document.getElementById('hermes-modal');
    if (modal) modal.style.display = 'none';
    pendingModalAction = null;
}

document.getElementById('modal-btn-cancel')?.addEventListener('click', hideConfirmationModal);
document.getElementById('modal-btn-confirm')?.addEventListener('click', () => {
    if (typeof pendingModalAction === 'function') {
        pendingModalAction();
    }
    hideConfirmationModal();
});
document.getElementById('hermes-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'hermes-modal') hideConfirmationModal();
});


// ==========================================================================
// Sessions Tab (Active / Archived / Delete with Alerts)
// ==========================================================================

let sessionsFilter = 'active';

function renderSessions() {
    const listContainer = document.getElementById('sessions-list');
    if (!listContainer) return;

    // Update counts on filter pills
    const activeCount = sessions.filter(s => !s.archived).length;
    const archivedCount = sessions.filter(s => !!s.archived).length;
    const allCount = sessions.length;

    const countActiveEl = document.getElementById('sessions-count-active');
    const countArchivedEl = document.getElementById('sessions-count-archived');
    const countAllEl = document.getElementById('sessions-count-all');
    if (countActiveEl) countActiveEl.textContent = activeCount;
    if (countArchivedEl) countArchivedEl.textContent = archivedCount;
    if (countAllEl) countAllEl.textContent = allCount;

    const searchInput = document.getElementById('sessions-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filtered = sessions.filter(s => {
        // Tab filter
        if (sessionsFilter === 'active' && s.archived) return false;
        if (sessionsFilter === 'archived' && !s.archived) return false;

        // Search query
        if (!query) return true;
        return (s.title && s.title.toLowerCase().includes(query)) ||
               (s.model && s.model.toLowerCase().includes(query)) ||
               (s.id && s.id.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        const emptyMsg = sessionsFilter === 'archived' 
            ? 'هیچ گفتگوی آرشیو شده‌ای یافت نشد.'
            : 'No sessions found.';
        listContainer.innerHTML = `<div class="empty-state"><p>${escapeHtml(emptyMsg)}</p></div>`;
        return;
    }

    listContainer.innerHTML = filtered.map(s => {
        const timeStr = formatRelativeTime(s.lastActive || s.updatedAt || s.startedAt);
        const shortModel = (s.model || 'Agent').split('/').pop().replace(/:free$/, '');
        const sid = escapeHtml(s.id || s.sessionId);
        const title = escapeHtml(s.title || s.id);
        const isArchived = !!s.archived;

        return `
            <div class="session-card ${isArchived ? 'session-archived' : ''}" data-id="${sid}">
                <div class="session-card-header">
                    <span class="card-title">${title}</span>
                    <span class="card-time">${escapeHtml(timeStr)}</span>
                </div>
                <div class="card-badges">
                    <span class="chip-tag chip-model">${escapeHtml(shortModel)}</span>
                    <span class="chip-tag chip-count">${s.messageCount || s.historyLen || 0} messages</span>
                    ${isArchived ? '<span class="chip-tag chip-archived-badge">📦 Archived</span>' : ''}
                </div>
                <div class="card-footer">
                    ${!isArchived ? `
                        <button class="btn-sm btn-resume-session" data-id="${sid}">▶ Resume</button>
                        <button class="btn-sm btn-archive-session" data-id="${sid}" data-title="${title}" title="Move to Archived">📦 Archive</button>
                    ` : `
                        <button class="btn-sm btn-restore-session" data-id="${sid}" data-title="${title}" title="Restore to Active Sessions">📤 Restore</button>
                        <button class="btn-sm btn-resume-session" data-id="${sid}">▶ View</button>
                    `}
                    <button class="btn-sm btn-delete-session" data-id="${sid}" data-title="${title}" title="Permanently delete session">🗑️ Delete</button>
                </div>
            </div>
        `;
    }).join('');

    // Resume click
    listContainer.querySelectorAll('.btn-resume-session').forEach(btn => {
        btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-id');
            if (sid) {
                vscode.postMessage({ type: 'loadSession', sessionId: sid });
            }
        });
    });

    // Archive click with confirmation modal
    listContainer.querySelectorAll('.btn-archive-session').forEach(btn => {
        btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-id');
            const title = btn.getAttribute('data-title') || sid;
            showConfirmationModal({
                icon: '📦',
                title: 'آرشیو گفتگو / Archive Session',
                message: `آیا از آرشیو کردن گفتگوی «${title}» اطمینان دارید؟`,
                calloutHtml: `
                    <div class="modal-info-callout">
                        <b>💡 نحوه دسترسی و بازگردانی:</b><br>
                        این گفتگو به تب <b>«📦 Archived»</b> در بالای همین صفحه منتقل شده و از لیست چت‌های فعال پنهان می‌شود. 
                        هر زمان بخواهید می‌توانید با مراجعه به تب آرشیو و کلیک روی دکمه <b>«📤 Restore»</b>، گفتگو را مجدداً به لیست چت‌های فعال بازگردانید.
                    </div>
                `,
                confirmText: 'بله، آرشیو شود',
                confirmClass: 'btn-accent',
                onConfirm: () => {
                    vscode.postMessage({ type: 'archiveSession', sessionId: sid });
                    showToast('📦 گفتگو با موفقیت آرشیو شد', 'info');
                }
            });
        });
    });

    // Restore click
    listContainer.querySelectorAll('.btn-restore-session').forEach(btn => {
        btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-id');
            vscode.postMessage({ type: 'restoreSession', sessionId: sid });
            showToast('📤 گفتگو به لیست چت‌های فعال بازگردانده شد', 'success');
        });
    });

    // Delete click with danger warning modal
    listContainer.querySelectorAll('.btn-delete-session').forEach(btn => {
        btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-id');
            const title = btn.getAttribute('data-title') || sid;
            showConfirmationModal({
                icon: '⚠️',
                title: 'حذف دائمی گفتگو / Delete Session',
                message: `آیا از حذف دائمی گفتگوی «${title}» اطمینان دارید؟`,
                calloutHtml: `
                    <div class="modal-danger-callout">
                        <b>⚠️ اخطار بسیار مهم (غیرقابل بازگشت):</b><br>
                        در صورت تأیید، این گفتگو و تمامی پیام‌ها و کدهای رد و بدل شده در آن برای همیشه از دیتابیس پاک شده و تحت هیچ شرایطی قابل دسترس یا بازگردانی نخواهد بود!
                    </div>
                `,
                confirmText: 'بله، برای همیشه حذف شود',
                confirmClass: 'btn-danger-confirm',
                onConfirm: () => {
                    vscode.postMessage({ type: 'deleteSession', sessionId: sid });
                    showToast('🗑 گفتگو برای همیشه حذف شد', 'warning');
                }
            });
        });
    });
}

// Sessions filter pills
document.querySelectorAll('#sessions-filter-pills .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('#sessions-filter-pills .filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        sessionsFilter = pill.getAttribute('data-filter') || 'active';
        renderSessions();
    });
});

document.getElementById('sessions-search')?.addEventListener('input', renderSessions);
document.getElementById('btn-sessions-refresh')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshDashboard' });
});
document.getElementById('btn-sessions-new')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'newSession' });
    switchTab('chat');
});

// ==========================================================================
// Skills Tab
// ==========================================================================

function renderSkills() {
    const listContainer = document.getElementById('skills-list');
    if (!listContainer) return;

    const searchInput = document.getElementById('skills-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filtered = skills.filter(s => {
        if (!query) return true;
        return (s.name && s.name.toLowerCase().includes(query)) ||
               (s.description && s.description.toLowerCase().includes(query)) ||
               (s.category && s.category.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div class="empty-state"><p>No skills found.</p></div>`;
        return;
    }

    listContainer.innerHTML = filtered.map(s => {
        const learnedBadge = s.isLearned ? `<span class="chip-tag chip-learned">🌟 Learned by Hermes</span>` : '';
        const catBadge = s.category ? `<span class="chip-tag chip-count">${escapeHtml(s.category)}</span>` : '';
        return `
            <div class="skill-card">
                <div class="skill-card-header">
                    <span class="card-title">⚡ ${escapeHtml(s.name)}</span>
                    <div class="card-badges">
                        ${learnedBadge}
                        ${catBadge}
                    </div>
                </div>
                <div class="card-desc">${escapeHtml(s.description)}</div>
                <div class="card-footer">
                    <button class="btn-sm btn-open-skill" data-path="${escapeHtml(s.path)}">📄 Open SKILL.md</button>
                    <button class="btn-sm btn-use-skill" data-name="${escapeHtml(s.name)}">⚡ Use in Chat</button>
                </div>
            </div>
        `;
    }).join('');

    listContainer.querySelectorAll('.btn-open-skill').forEach(btn => {
        btn.addEventListener('click', () => {
            const spath = btn.getAttribute('data-path');
            if (spath) vscode.postMessage({ type: 'openSkillFile', skillPath: spath });
        });
    });

    listContainer.querySelectorAll('.btn-use-skill').forEach(btn => {
        btn.addEventListener('click', () => {
            const sname = btn.getAttribute('data-name');
            if (sname) vscode.postMessage({ type: 'injectSkill', skillName: sname });
        });
    });
}

document.getElementById('skills-search')?.addEventListener('input', renderSkills);
document.getElementById('btn-skills-refresh')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshDashboard' });
});

// ==========================================================================
// Models & Operators Tab (Form & GUI Switcher)
// ==========================================================================

function renderModels() {
    if (!modelConfig) return;

    const cur = modelConfig.current || {};
    const providers = modelConfig.providers || [];

    // 1. Active Model Card
    const activeModelName = document.getElementById('active-model-name');
    if (activeModelName) activeModelName.textContent = cur.model || 'Not configured';

    const activeProviderName = document.getElementById('active-provider-name');
    if (activeProviderName) activeProviderName.textContent = `Operator: ${(cur.provider || 'openrouter').toUpperCase()}`;

    // 2. Populate Providers Dropdown
    const provSelect = document.getElementById('select-provider');
    if (provSelect) {
        const curSelected = selectedProviderId || cur.provider || 'openrouter';
        provSelect.innerHTML = providers.map(p => `
            <option value="${escapeHtml(p.id)}" ${p.id === curSelected ? 'selected' : ''}>
                ${escapeHtml(p.name)}
            </option>
        `).join('');

        if (!provSelect.dataset.hasListener) {
            provSelect.dataset.hasListener = 'true';
            provSelect.addEventListener('change', () => {
                selectedProviderId = provSelect.value;
                updateProviderForm();
            });
        }
    }

    selectedProviderId = provSelect ? provSelect.value : (cur.provider || 'openrouter');
    updateProviderForm();
}

function updateProviderForm() {
    if (!modelConfig) return;
    const providers = modelConfig.providers || [];
    const prov = providers.find(p => p.id === selectedProviderId) || providers[0];
    if (!prov) return;

    // API Key status & input
    const keyTag = document.getElementById('key-status-indicator');
    const keyInput = document.getElementById('input-api-key');
    const keyGroup = document.getElementById('group-api-key');
    const baseUrlGroup = document.getElementById('group-base-url');
    const baseUrlInput = document.getElementById('input-base-url');

    if (prov.id === 'ollama') {
        if (keyTag) {
            keyTag.textContent = 'Local (No Key Needed)';
            keyTag.className = 'key-status-tag configured';
        }
        if (keyInput) {
            keyInput.value = '';
            keyInput.disabled = true;
            keyInput.placeholder = 'Local server at http://localhost:11434';
        }
    } else {
        if (keyInput) keyInput.disabled = false;
        if (prov.hasKey) {
            if (keyTag) {
                keyTag.textContent = `✓ Configured in .env (${prov.keyMasked})`;
                keyTag.className = 'key-status-tag configured';
            }
            if (keyInput && !keyInput.value) {
                keyInput.placeholder = `Current: ${prov.keyMasked} (leave blank to keep)`;
            }
        } else {
            if (keyTag) {
                keyTag.textContent = `⚠️ Key Missing (${prov.envVar || 'API Key'})`;
                keyTag.className = 'key-status-tag missing';
            }
            if (keyInput) keyInput.placeholder = `Enter ${prov.envVar || 'API Key'}`;
        }
    }

    // Base URL visibility for custom provider
    if (baseUrlGroup) {
        if (prov.id === 'custom' || prov.id === 'ollama') {
            baseUrlGroup.style.display = 'flex';
            if (baseUrlInput && !baseUrlInput.value) baseUrlInput.value = prov.baseUrl || '';
        } else {
            baseUrlGroup.style.display = 'none';
        }
    }

    // Populate Models
    populateModelSelect(prov);
}

function populateModelSelect(prov) {
    const modelSelect = document.getElementById('select-model');
    const countLabel = document.getElementById('model-count-label');
    if (!modelSelect) return;

    const allModels = prov.models || [];
    let filtered = allModels;

    if (selectedModelFilter === 'free') {
        filtered = allModels.filter(m => m.id.endsWith(':free') || (m.tag && m.tag.toLowerCase().includes('free')));
    } else if (selectedModelFilter === 'top') {
        filtered = allModels.filter(m => m.tag && (m.tag.includes('Top') || m.tag.includes('Flagship') || m.tag.includes('Recommended') || m.tag.includes('Smart') || m.tag.includes('Capable')));
    } else if (selectedModelFilter === 'fast') {
        filtered = allModels.filter(m => m.tag && (m.tag.includes('Fast') || m.tag.includes('Instant') || m.id.includes('flash') || m.id.includes('haiku') || m.id.includes('mini') || m.id.includes('lite')));
    }

    if (countLabel) countLabel.textContent = `(${filtered.length} available)`;

    const curDefault = modelConfig?.current?.model;
    modelSelect.innerHTML = filtered.map(m => {
        const cleanName = (m.name || m.id).replace(/\s*\((free|Free)\)/g, '').replace(/\s*\[(free|Free)\]/g, '').trim();
        const tagStr = m.tag ? ` [${escapeHtml(m.tag)}]` : '';
        const isSelected = m.id === curDefault;
        return `<option value="${escapeHtml(m.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(cleanName)}${tagStr}</option>`;
    }).join('');

    // If current model is not in list, add it
    if (curDefault && !filtered.some(m => m.id === curDefault) && prov.id === modelConfig?.current?.provider) {
        const opt = document.createElement('option');
        opt.value = curDefault;
        opt.textContent = `${curDefault} [Current]`;
        opt.selected = true;
        modelSelect.insertBefore(opt, modelSelect.firstChild);
    }
}

// Filter chips
document.querySelectorAll('#model-filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('#model-filter-chips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        selectedModelFilter = chip.getAttribute('data-filter') || 'all';
        if (modelConfig) {
            const prov = (modelConfig.providers || []).find(p => p.id === selectedProviderId);
            if (prov) populateModelSelect(prov);
        }
    });
});

// Custom model toggle
const customCheck = document.getElementById('check-custom-model');
const customInput = document.getElementById('input-custom-model');
if (customCheck && customInput) {
    customCheck.addEventListener('change', () => {
        customInput.style.display = customCheck.checked ? 'block' : 'none';
        if (customCheck.checked) customInput.focus();
    });
}

// Key visibility toggle
const toggleKeyBtn = document.getElementById('btn-toggle-key-visibility');
const keyInputEl = document.getElementById('input-api-key');
if (toggleKeyBtn && keyInputEl) {
    toggleKeyBtn.addEventListener('click', () => {
        keyInputEl.type = keyInputEl.type === 'password' ? 'text' : 'password';
        toggleKeyBtn.textContent = keyInputEl.type === 'password' ? '👁️' : '🔒';
    });
}

// Apply Model Button
document.getElementById('btn-save-model-config')?.addEventListener('click', () => {
    const provSelect = document.getElementById('select-provider');
    const modelSelect = document.getElementById('select-model');
    const keyInput = document.getElementById('input-api-key');
    const baseUrlInput = document.getElementById('input-base-url');
    const customCheck = document.getElementById('check-custom-model');
    const customInput = document.getElementById('input-custom-model');
    const feedback = document.getElementById('model-save-feedback');
    const btn = document.getElementById('btn-save-model-config');

    const provider = provSelect ? provSelect.value : 'openrouter';
    let model = modelSelect ? modelSelect.value : '';
    if (customCheck && customCheck.checked && customInput && customInput.value.trim()) {
        model = customInput.value.trim();
    }

    if (!model) {
        if (feedback) {
            feedback.textContent = 'Please select or enter a model ID.';
            feedback.className = 'feedback-msg error';
        }
        return;
    }

    const apiKey = keyInput ? keyInput.value.trim() : '';
    const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="btn-icon">⏳</span><span>Applying & Connecting...</span>`;
    }

    vscode.postMessage({
        type: 'saveModelConfig',
        provider,
        model,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined
    });

    showToast(`🚀 در حال اعمال ${model}...`, 'info');

    if (feedback) {
        feedback.textContent = `Applying ${model} on ${provider}...`;
        feedback.className = 'feedback-msg success';
    }

    setTimeout(() => {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span class="btn-icon">🚀</span><span>Apply & Start New Chat</span>`;
        }
    }, 4000);
});

// ==========================================================================
// Settings Tab
// ==========================================================================

function renderSettings() {
    const autoApproveSwitch = document.getElementById('setting-auto-approve');
    if (autoApproveSwitch && appConfig) {
        autoApproveSwitch.checked = !!appConfig.autoApprove;
    }

    const cwdLabel = document.getElementById('setting-cwd-label');
    if (cwdLabel && appConfig) {
        cwdLabel.textContent = appConfig.cwd || 'Workspace Root';
    }
}

document.getElementById('setting-auto-approve')?.addEventListener('change', () => {
    vscode.postMessage({ type: 'toggleAutoApprove' });
    showToast('⚙️ تنظیمات مجوز به‌روزرسانی شد', 'info');
});

document.getElementById('btn-reconnect-hermes')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'reconnect' });
    showToast('↻ در حال تلاش برای اتصال به هرمس...', 'info');
});

document.getElementById('btn-run-setup-terminal')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'runSetup' });
    showToast('⚙️ راه‌اندازی در ترمینال باز شد', 'info');
});

// ==========================================================================
// Utilities
// ==========================================================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function formatRelativeTime(ts) {
    if (!ts) return '';
    const time = typeof ts === 'string' ? (isNaN(Number(ts)) ? new Date(ts).getTime() : Number(ts) * (ts.length === 10 ? 1000 : 1)) : (ts < 10000000000 ? ts * 1000 : ts);
    if (!time || isNaN(time)) return '';

    const diff = Math.floor((Date.now() - time) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(time).toLocaleDateString();
}

// Initial render
renderAll();
