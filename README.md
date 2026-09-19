# Hermes Agent VS Code Extension

Official VS Code extension for [Hermes Agent](https://github.com/NousResearch/hermes-agent) — the self-improving AI agent with persistent memory, skills, and multi-platform messaging gateway.

## Features

### 🤖 **Full ACP Integration**
- Connects to Hermes Agent via Agent Client Protocol (ACP)
- Native JSON-RPC 2.0 over stdio transport
- Supports all Hermes capabilities: tools, skills, sessions, model switching

### 💬 **Rich Chat Interface**
- Streaming markdown rendering with syntax highlighting
- Tool call visualization with status indicators (running/done/error)
- Thinking/reasoning display with collapsible sections
- Image rendering from Hermes `MEDIA:/path` protocol
- Copy buttons on code blocks

### 📋 **Session Management**
- Persistent sessions across VS Code reloads
- Session picker: create, switch, rename, delete
- Auto-titled from first user message
- Full conversation history preserved

### 🔧 **Skills Integration**
- Skills picker loads from `~/.hermes/skills/`
- Multi-select injection as advisory prefix in prompts
- Category-organized tree view

### ⚙️ **Model & Provider Switching**
- Anthropic Claude + OpenAI Codex in grouped picker
- Switch via header dropdown or slash commands
- Dynamic catalog from Hermes model cache

### 📊 **Token Tracking**
- Context usage displayed as `Xk / 1M` with progress bar
- Color warnings at 70% (gold) and 90% (red)
- Real-time updates during streaming

### ⌨️ **Slash Commands**
Grouped command menu with three dispatch modes:
| Section | Commands |
|---------|----------|
| **Session** | `/title`, `/new`, `/retry`, `/compact`, `/save` |
| **Info** | `/context`, `/usage`, `/tools`, `/help` |
| **Config** | `/yolo` (auto-approve), `/reasoning` |
| **Danger** | `/reset` (with confirmation) |

### 🔄 **Queue & Interrupt**
- Send follow-ups while busy (queued)
- New messages cancel current turn
- Visual indicator while agent is working

### 📁 **File & Terminal Integration**
- Edited files auto-open in VS Code
- Reads open as preview tabs
- Terminal output displayed in-line
- Todo overlay from Hermes's todo tool

## Requirements

- **Hermes CLI** installed and authenticated
  ```bash
  # Windows (PowerShell)
  irm https://hermes-agent.nousresearch.com/install.ps1 | iex
  
  # Linux/macOS/WSL
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
  ```
- Run `hermes setup` to configure providers
- VS Code 1.85+

## Installation

### From VS Code Marketplace (Coming Soon)
Search for "Hermes Agent" in the Extensions view.

### From VSIX (Manual)
```bash
# Build the extension
npm install
npm run compile
npm run package

# Install the VSIX
code --install-extension hermes-vscode-1.0.0.vsix
```

## Quick Start

1. Install Hermes CLI and run `hermes setup`
2. Install this extension
3. Open the Hermes panel from Activity Bar (sparkle icon)
4. Click "Connect" or run **Hermes: Connect** command
5. Start chatting!

## Configuration

All settings under `hermes.*` namespace:

| Setting | Default | Description |
|---------|---------|-------------|
| `hermes.enabled` | `true` | Enable/disable extension |
| `hermes.acpCommand` | `"hermes"` | Command to start ACP server |
| `hermes.acpArgs` | `["acp"]` | ACP command arguments |
| `hermes.cwd` | `"${workspaceFolder}"` | Working directory |
| `hermes.autoApprovePermissions` | `false` | Auto-approve tool permissions |
| `hermes.showTokenUsage` | `true` | Show token usage in status bar |
| `hermes.streamingEnabled` | `true` | Enable streaming responses |
| `hermes.maxHistory` | `100` | Max messages in chat history |
| `hermes.skillsPath` | `"~/.hermes/skills"` | Skills directory path |
| `hermes.model` | `""` | Default model (empty = Hermes default) |
| `hermes.provider` | `""` | Default provider (empty = Hermes default) |
| `hermes.logLevel` | `"info"` | Log level (debug/info/warn/error) |

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `hermes.connect` | `Ctrl+Alt+H` | Connect to Hermes |
| `hermes.disconnect` | | Disconnect from Hermes |
| `hermes.newSession` | `Ctrl+Alt+N` | Create new session |
| `hermes.openChat` | | Open chat panel |
| `hermes.sendPrompt` | | Send prompt (from editor) |
| `hermes.cancelTurn` | `Ctrl+Alt+C` | Cancel current turn |
| `hermes.switchModel` | | Switch model |
| `hermes.switchProvider` | | Switch provider |
| `hermes.toggleAutoApprove` | | Toggle auto-approve |
| `hermes.pickSkill` | | Pick skills to inject |
| `hermes.refreshSessions` | | Refresh session list |
| `hermes.runSetup` | | Run `hermes setup` in terminal |
| `hermes.checkACP` | | Run `hermes acp --check` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      VS Code Extension                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Chat View   │  │ Sessions    │  │ Skills/Tools Views  │  │
│  │ (Webview)   │  │ Tree View   │  │ (Tree Views)        │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          ▼                                   │
│              ┌─────────────────────┐                         │
│              │   Extension Core    │                         │
│              │  (Event Coordinator)│                         │
│              └──────────┬──────────┘                         │
│                         │                                     │
│         ┌───────────────┼───────────────┐                    │
│         ▼               ▼               ▼                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ ACP Client  │ │Permission   │ │ File/Term   │           │
│  │ (JSON-RPC)  │ │ Handler     │ │ Handlers    │           │
│  └──────┬──────┘ └─────────────┘ └─────────────┘           │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────────────┐                                     │
│  │  hermes acp proc    │  (spawned subprocess)              │
│  │  JSON-RPC over stdio│                                     │
│  └─────────────────────┘                                     │
└─────────────────────────────────────────────────────────────┘
```

## Development

```bash
# Clone and install
git clone https://github.com/NousResearch/hermes-agent
cd hermes-agent/vscode-extension  # or wherever this repo lives
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Lint
npm run lint

# Package
npm run package
```

## Hermes Agent Features

Hermes Agent provides unique capabilities beyond standard coding agents:

- **Persistent Memory** — Remembers who you are, preferences, and lessons across sessions
- **Self-Improving Skills** — Creates reusable skills from experience
- **Multi-Platform Gateway** — Same agent runs on Telegram, Discord, Slack, WhatsApp, Signal, Email, Teams, Matrix, IRC
- **Provider Agnostic** — Works with OpenRouter, Anthropic, OpenAI, Google, DeepSeek, xAI, local models, and 20+ others
- **Profiles** — Multiple independent instances with isolated configs
- **Extensible** — Plugins, MCP servers, custom tools, webhook triggers, cron scheduling

## Links

- [Hermes Agent Documentation](https://hermes-agent.nousresearch.com/docs/)
- [Hermes Agent GitHub](https://github.com/NousResearch/hermes-agent)
- [Agent Client Protocol](https://agentclientprotocol.com/)
- [Report Issues](https://github.com/NousResearch/hermes-agent/issues)

## License

MIT — see [LICENSE](LICENSE) for details.

Built with ❤️ by [Nous Research](https://nousresearch.com/)