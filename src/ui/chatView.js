const vscode = acquireVsCodeApi();

let messages = [];
let connected = false;
let sessionId = null;
let sessionTitle = null;
let tokenUsage = null;

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            messages = message.messages || [];
            connected = message.connected;
            sessionId = message.sessionId;
            sessionTitle = message.sessionTitle || null;
            tokenUsage = message.tokenUsage;
            render();
            break;
    }
});

function render() {
    renderHeader();
    renderMessages();
    renderComposer();
}

function renderHeader() {
    const header = document.getElementById('header');
    if (!header) return;

    header.className = connected ? 'connected' : 'disconnected';

    const statusIndicator = header.querySelector('.indicator');
    const statusText = header.querySelector('.text');
    if (statusIndicator && statusText) {
        statusIndicator.className = `indicator ${connected ? 'connected' : 'disconnected'}`;
        statusText.textContent = connected ? 'Connected' : 'Disconnected';
    }

    const sessionInfo = header.querySelector('.session-info');
    if (sessionInfo) {
        let html = '';
        if (sessionId) {
            const displayTitle = sessionTitle || sessionId.slice(0, 8);
            const fullTitle = sessionTitle ? `${sessionTitle} (${sessionId})` : sessionId;
            html += `<span class="session-id" title="${escapeHtml(fullTitle)}">${escapeHtml(displayTitle)}</span>`;
        }
        if (tokenUsage) {
            html += `<span class="tokens">${tokenUsage.total || (tokenUsage.promptTokens + tokenUsage.completionTokens) || 0} tokens</span>`;
        }
        sessionInfo.innerHTML = html;

        const badge = sessionInfo.querySelector('.session-id');
        if (badge) {
            badge.addEventListener('click', () => {
                if (sessionId) {
                    navigator.clipboard.writeText(sessionId).then(() => {
                        const original = badge.textContent;
                        badge.textContent = '✓ Copied ID';
                        setTimeout(() => { badge.textContent = original; }, 1500);
                    });
                }
            });
        }
    }
}

function renderMessages() {
    const container = document.getElementById('messages');
    if (!container) return;

    if (!messages || messages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚚</div>
                <h2>Hermes AI Assistant</h2>
                <p>Autonomous AI agent powered by local knowledge, custom skills, and ACP.</p>
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

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;

    // Apply syntax highlighting
    if (typeof hljs !== 'undefined') {
        container.querySelectorAll('pre code').forEach(block => {
            try {
                hljs.highlightElement(block);
            } catch (e) {
                // Ignore highlight errors
            }
        });
    }

    // Wrap pre/code blocks with header & copy button
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.closest('.code-block-wrapper')) return;

        const code = pre.querySelector('code');
        let lang = 'code';
        if (code) {
            const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
            if (langClass) {
                lang = langClass.replace('language-', '');
            }
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
        try {
            contentHtml = marked.parse(msg.content || '');
        } catch {
            contentHtml = escapeHtml(msg.content || '');
        }
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
            <div class="message-content">
                ${contentHtml}
            </div>
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

    if (tc.error) {
        resultHtml = `<div class="tool-error"><pre><code>${escapeHtml(String(tc.error))}</code></pre></div>`;
    }

    return `
        <div class="tool-call ${statusClass}">
            <div class="tool-header">
                <span class="tool-kind">${escapeHtml(tc.kind || 'tool')}</span>
                <span class="tool-name">${escapeHtml(tc.name || '')}</span>
                <span class="tool-title">${escapeHtml(tc.title || '')}</span>
                <span class="tool-status">${statusIcon}</span>
            </div>
            <div class="tool-args">${argsHtml}</div>
            ${resultHtml}
        </div>
    `;
}

function renderComposer() {
    const sendBtn = document.getElementById('btn-send');
    const input = document.getElementById('prompt-input');

    if (sendBtn) {
        sendBtn.disabled = !connected;
    }
    if (input) {
        input.disabled = !connected;
        input.placeholder = connected ? 'Ask Hermes anything... (Enter to send, Shift+Enter for newline)' : 'Connect to Hermes first';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Event listeners
document.addEventListener('click', e => {
    const target = e.target;
    if (!target) return;

    if (target.id === 'btn-send') {
        sendPrompt();
    } else if (target.id === 'btn-new-session') {
        vscode.postMessage({ type: 'newSession' });
    } else if (target.id === 'btn-skill') {
        vscode.postMessage({ type: 'pickSkill' });
    } else if (target.id === 'btn-model') {
        vscode.postMessage({ type: 'switchModel' });
    } else if (target.id === 'btn-cancel') {
        vscode.postMessage({ type: 'cancelTurn' });
    } else if (target.id === 'btn-clear') {
        vscode.postMessage({ type: 'clearHistory' });
    }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        const input = document.getElementById('prompt-input');
        if (e.target === input) {
            e.preventDefault();
            sendPrompt();
        }
    }
});

function sendPrompt() {
    const input = document.getElementById('prompt-input');
    if (!input || !input.value.trim()) return;

    const text = input.value.trim();
    input.value = '';
    input.style.height = 'auto';

    vscode.postMessage({ type: 'sendPrompt', text });
}

// Auto-resize textarea
const promptInput = document.getElementById('prompt-input');
if (promptInput) {
    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
    });
}

// Initial render
render();
