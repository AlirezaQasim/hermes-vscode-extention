const vscode = acquireVsCodeApi();

let messages = [];
let connected = false;
let sessionId = null;
let tokenUsage = null;

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            messages = message.messages || [];
            connected = message.connected;
            sessionId = message.sessionId;
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
            html += `<span class="session-id">${sessionId}</span>`;
        }
        if (tokenUsage) {
            html += `<span class="tokens">${tokenUsage.total} tokens</span>`;
        }
        sessionInfo.innerHTML = html;
    }
}

function renderMessages() {
    const container = document.getElementById('messages');
    if (!container) return;

    container.innerHTML = messages.map(msg => renderMessage(msg)).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;

    // Apply syntax highlighting
    container.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
    });
}

function renderMessage(msg) {
    const time = new Date(msg.timestamp).toLocaleTimeString();
    const roleClass = `role-${msg.role}`;

    let contentHtml = '';
    if (msg.role === 'tool') {
        contentHtml = `<pre><code>${escapeHtml(JSON.stringify(msg.content, null, 2))}</code></pre>`;
    } else {
        contentHtml = marked.parse(msg.content);
    }

    let thinkingHtml = '';
    if (msg.thinking) {
        thinkingHtml = `
            <div class="thinking">
                <details open>
                    <summary>💭 Thinking</summary>
                    <div class="thinking-content">${marked.parse(msg.thinking)}</div>
                </details>
            </div>
        `;
    }

    let toolCallsHtml = '';
    if (msg.toolCalls && msg.toolCalls.length > 0) {
        toolCallsHtml = msg.toolCalls.map(tc => renderToolCall(tc)).join('');
    }

    return `
        <div class="message ${roleClass}" data-id="${msg.id}">
            <div class="message-header">
                <span class="role">${msg.role}</span>
                <span class="time">${time}</span>
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
                <span class="tool-kind">${tc.kind || 'tool'}</span>
                <span class="tool-name">${tc.name}</span>
                <span class="tool-title">${tc.title || ''}</span>
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
        input.placeholder = connected ? 'Type your message...' : 'Connect to Hermes first';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event listeners
document.addEventListener('click', e => {
    const target = e.target;

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

    const text = input.value;
    input.value = '';
    input.style.height = 'auto';

    vscode.postMessage({ type: 'sendPrompt', text });
}

// Auto-resize textarea
const input = document.getElementById('prompt-input');
if (input) {
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });
}

// Initial render
render();