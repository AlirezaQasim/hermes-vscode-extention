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
            renderAll();
            break;
    }
});

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
            break;
        case 'settings':
            renderSettings();
            break;
    }
}

// ==========================================================================
// Navigation & Tabs
// ==========================================================================

function switchTab(tabId) {
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
}

// Setup navbar click listeners
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabId = tab.getAttribute('data-tab');
        if (tabId) switchTab(tabId);
    });
});

// ==========================================================================
// Chat Tab
// ==========================================================================

function renderChatHeader() {
    const header = document.getElementById('chat-header');
    if (!header) return;

    header.className = connected ? 'connected' : 'disconnected';
    const statusLabel = header.querySelector('.status-label');
    if (statusLabel) {
        statusLabel.textContent = connected ? 'Connected' : 'Disconnected';
    }

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
        const curModel = modelConfig?.current?.model || 'Hermes AI';
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚚</div>
                <h2>Hermes AI Assistant</h2>
                <p>Autonomous AI agent running on <strong>${escapeHtml(curModel)}</strong>.</p>
                <div class="quick-prompts">
                    <button class="quick-prompt" data-prompt="Explain this project architecture and codebase structure">
                        <span>🔍</span>
                        <span>Explain Project Architecture</span>
                    </button>
                    <button class="quick-prompt" data-prompt="Review recent git commits and current git status">
                        <span>📜</span>
                        <span>Review Git Status & Commits</span>
                    </button>
                    <button class="quick-prompt" data-prompt="Scan for potential bugs, errors, or performance bottlenecks in this workspace">
                        <span>⚡</span>
                        <span>Find Bugs & Optimize Code</span>
                    </button>
                    <button class="quick-prompt" data-prompt="List available skills and how they can be used for this project">
                        <span>🧠</span>
                        <span>Explore Available Skills</span>
                    </button>
                </div>
            </div>
        `;

        container.querySelectorAll('.quick-prompt').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.getAttribute('data-prompt');
                if (prompt) {
                    const input = document.getElementById('prompt-input');
                    if (input) {
                        input.value = prompt;
                        sendPrompt();
                    }
                }
            });
        });
        return;
    }

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
    const roleClass = `role-${msg.role || 'assistant'}`;
    const roleDisplay = msg.role === 'assistant' ? 'Hermes' : (msg.role ? msg.role.charAt(0).toUpperCase() + msg.role.slice(1) : 'Assistant');

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
                    <summary>💭 Thinking</summary>
                    <div class="thinking-content">${thinkingParsed}</div>
                </details>
            </div>
        `;
    }

    let toolCallsHtml = '';
    if (msg.toolCalls && msg.toolCalls.length > 0) {
        toolCallsHtml = msg.toolCalls.map(tc => renderToolCall(tc)).join('');
    }

    return `
        <div class="message ${roleClass}" data-id="${escapeHtml(msg.id || '')}">
            <div class="message-header">
                <span class="role-badge">${escapeHtml(roleDisplay)}</span>
                <span class="time">${escapeHtml(time)}</span>
            </div>
            <div class="message-content">${contentHtml}</div>
            ${thinkingHtml}
            ${toolCallsHtml}
        </div>
    `;
}

function renderToolCall(tc) {
    const statusClass = `status-${tc.status || 'running'}`;
    const statusIcon = tc.status === 'done' ? '✓' : tc.status === 'error' ? '✗' : '⟳';

    let argsHtml = '';
    try {
        argsHtml = `<pre><code>${escapeHtml(JSON.stringify(tc.args, null, 2))}</code></pre>`;
    } catch {
        argsHtml = `<pre><code>${escapeHtml(String(tc.args))}</code></pre>`;
    }

    let resultHtml = '';
    if (tc.result) {
        try {
            resultHtml = `<div class="tool-result"><pre><code>${escapeHtml(JSON.stringify(tc.result, null, 2))}</code></pre></div>`;
        } catch {
            resultHtml = `<div class="tool-result"><pre><code>${escapeHtml(String(tc.result))}</code></pre></div>`;
        }
    }

    return `
        <div class="tool-call ${statusClass}">
            <div class="tool-header">
                <span class="tool-kind">${escapeHtml(tc.kind || 'tool')}</span>
                <span class="tool-name">${escapeHtml(tc.name || '')}</span>
                <span class="tool-status">${statusIcon}</span>
            </div>
            <div class="tool-args">${argsHtml}</div>
            ${resultHtml}
        </div>
    `;
}

function renderComposer() {
    const sendBtn = document.getElementById('btn-send-prompt');
    const input = document.getElementById('prompt-input');

    if (sendBtn) sendBtn.disabled = !connected;
    if (input) {
        input.disabled = !connected;
        input.placeholder = connected ? 'Ask Hermes anything... (Enter to send, Shift+Enter for newline)' : 'Connect to Hermes first';
    }
}

function sendPrompt() {
    const input = document.getElementById('prompt-input');
    if (!input || !input.value.trim()) return;

    const text = input.value.trim();
    input.value = '';
    input.style.height = 'auto';

    vscode.postMessage({ type: 'sendPrompt', text });
}

// Keyboard shortcuts for prompt
const promptInput = document.getElementById('prompt-input');
if (promptInput) {
    promptInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendPrompt();
        }
    });
    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + 'px';
    });
}

const sendPromptBtn = document.getElementById('btn-send-prompt');
if (sendPromptBtn) {
    sendPromptBtn.addEventListener('click', sendPrompt);
}

// Composer toolbar buttons
document.getElementById('btn-new-session')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'newSession' });
});
document.getElementById('btn-switch-model-quick')?.addEventListener('click', () => {
    switchTab('models');
});
document.getElementById('btn-stop-turn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelTurn' });
});
document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearHistory' });
});

// ==========================================================================
// Confirmation Modal System
// ==========================================================================

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
                }
            });
        });
    });

    // Restore click
    listContainer.querySelectorAll('.btn-restore-session').forEach(btn => {
        btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-id');
            vscode.postMessage({ type: 'restoreSession', sessionId: sid });
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
});

document.getElementById('btn-reconnect-hermes')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'reconnect' });
});

document.getElementById('btn-run-setup-terminal')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'runSetup' });
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
