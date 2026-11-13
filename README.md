# Hermes Agent VS Code Extension

[![Version](https://img.shields.io/badge/version-1.0.0-gold.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.txt)
[![ACP Protocol](https://img.shields.io/badge/Protocol-ACP-emerald.svg)](https://agentclientprotocol.com/)

The official Visual Studio Code extension for [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research — the self-improving AI agent with persistent memory, autonomous skill synthesis, and multi-platform messaging gateway.

Hermes Agent connects directly to your local environment via the **Agent Client Protocol (ACP)** over stdio, providing real-time streaming, tool execution, and an elegant Obsidian-Gold interface.

---

## Features

### ⚡ **Native Agent Client Protocol (ACP)**
- Direct JSON-RPC 2.0 communication over stdio with zero middleman overhead.
- Live agent activity tracking: Idle, Thinking, Autonomous Skill Creation, and Tool Execution.
- Auto-approve permissions mode for seamless background automation.

### 💬 **Fluid Obsidian-Gold Chat Experience**
- Modern, distraction-free interface built for speed and focus.
- **Real-Time Token Streaming**: Instant response rendering with syntax-highlighted code blocks and one-click copy.
- **Collapsible Thinking Accordions**: View internal reasoning and elapsed millisecond generation counters.
- **Floating Command Capsule**: Quick model switching, turn controls, and prompt execution.

### 🌐 **Full Internationalization (BiDi Engine)**
- First-class support for both **English (LTR)** and **فارسی / Persian (RTL)**.
- Instant language toggle in settings with proper directional text isolation.

### 📋 **Session Management & History**
- Persistent conversations across sessions with instant local recovery.
- Segmented views for **Active** and **Archived** conversations.
- Real-time search across past chats by title, model, or session ID.

### 🧠 **Autonomous Skills & Learning**
- Instant discovery of skills loaded on-demand from disk.
- Highlights **🌟 Learned Skills** synthesized autonomously by Hermes.
- One-click prompt injection and direct file inspection in the editor.

### ⚙️ **Multi-Provider & Model Switching**
- Switch between models and providers (OpenRouter, Anthropic, OpenAI, local models) without restarting.
- Live API key configuration and hot-reload detection for configuration updates.

### ⌨️ **Slash Commands**
Integrated command palette triggered with `/`:
| Command | Description |
|:---|:---|
| `/new` | Start a clean new conversation session |
| `/model` | Switch the active LLM provider or model |
| `/skills` | Browse and inject custom skills into the chat |
| `/approve` | Toggle automatic approval for tool permissions |
| `/title` | Rename the current session |
| `/reset` | Clear the session history |

---

## Requirements

1. **Hermes CLI** installed on your system:
   ```powershell
   # Windows (PowerShell)
   irm https://hermes-agent.nousresearch.com/install.ps1 | iex
   ```
   ```bash
   # Linux / macOS / WSL
   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   ```
2. Run `hermes setup` to configure your API keys and default provider.
3. **VS Code** 1.85.0 or later.

---

## Installation

### From VSIX Package
Download the latest `hermes-vscode-1.0.0.vsix` release and install it via terminal:
```bash
code --install-extension hermes-vscode-1.0.0.vsix --force
```
*(Or in VS Code: Extensions view (`Ctrl+Shift+X`) → `...` menu → "Install from VSIX...")*

> **Note for Users:** The packaged extension is completely self-contained. You do **not** need Node.js or `npm` installed to run the extension.

---

## Quick Start

1. Open the Hermes sidebar by clicking the **Hermes** icon in the Secondary Sidebar (or press `Ctrl+Alt+H`).
2. The extension automatically detects your local Hermes CLI installation and connects.
3. Start chatting or execute commands with `/`.

---

## Configuration Settings

Configurations are located under the `hermes.*` namespace in VS Code Settings (`Ctrl+,`):

| Setting | Default | Description |
|:---|:---|:---|
| `hermes.enabled` | `true` | Enable or disable the extension |
| `hermes.acpCommand` | `"hermes"` | Path or command for the Hermes executable (auto-discovered) |
| `hermes.acpArgs` | `["acp"]` | Command arguments passed to start the ACP server |
| `hermes.cwd` | `"${workspaceFolder}"` | Working directory for agent execution |
| `hermes.autoApprovePermissions` | `false` | Automatically approve tool execution requests |
| `hermes.showTokenUsage` | `true` | Display real-time token metrics in the status bar |
| `hermes.streamingEnabled` | `true` | Enable live token streaming |
| `hermes.skillsPath` | `"~/.hermes/skills"` | Path to the Hermes skills directory |
| `hermes.logLevel` | `"info"` | Logging verbosity (`debug`, `info`, `warn`, `error`) |

---

## Shortcuts & Keybindings

| Action | Shortcut |
|:---|:---|
| **Connect to Hermes** | `Ctrl+Alt+H` |
| **New Session** | `Ctrl+Alt+N` |
| **Cancel Current Turn** | `Ctrl+Alt+C` |

---

## Contributing & Building from Source

For developers who want to contribute to the extension:

```bash
# 1. Clone repository
git clone https://github.com/AlirezaQasim/hermes-vscode-extention.git
cd hermes-vscode-extention

# 2. Install development dependencies
npm install

# 3. Build project
npm run build

# 4. Run tests
npm test

# 5. Package VSIX
npm run package
```

---

## License

This project is licensed under the [MIT License](LICENSE.txt).

Developed with ❤️ for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) ecosystem.
