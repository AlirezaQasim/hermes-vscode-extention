# Hermes Agent VS Code Extension

[![Version](https://img.shields.io/badge/version-1.0.0-gold.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.txt)
[![Protocol](https://img.shields.io/badge/Protocol-ACP%20v1%20(JSON--RPC%202.0)-emerald.svg)](https://agentclientprotocol.com/)
[![Frontend](https://img.shields.io/badge/Frontend-Svelte%204-ff3e00.svg)](https://svelte.dev/)
[![Language](https://img.shields.io/badge/Language-TypeScript%205-3178c6.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-31%20Passed-brightgreen.svg)](test/)

The official Visual Studio Code extension for [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research — the self-improving AI coding agent featuring persistent memory, autonomous skill synthesis, and multi-platform messaging gateway.

The extension connects to your local Hermes instance through the standard **Agent Client Protocol (ACP)** over `stdio`, powered by a high-performance, reactive **Svelte** interface crafted with the **Obsidian-Gold** design system.

---

## 🛠️ Standards & Tech Stack

This project is built in adherence to modern open-source software engineering standards:

* **Protocol Standard:** [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) — standard JSON-RPC 2.0 communication over standard input/output (`stdio`).
* **Frontend Framework:** [Svelte 4](https://svelte.dev/) Single-Page Application (SPA) inside VS Code Webview with reactive state stores and sub-millisecond DOM updates.
* **Core Language:** [TypeScript 5](https://www.typescriptlang.org/) for strict type safety across extension host and webview layers.
* **Design System:** Obsidian-Gold dark aesthetic with fluid Glassmorphism, CSS variable theming, and micro-interactions.
* **Internationalization (i18n):** Native Bidirectional (BiDi) engine supporting **English (LTR)** and **فارسی / Persian (RTL)** with strict unicode isolation (`unicode-bidi: plaintext`).
* **Bundling & Build Pipeline:** [esbuild](https://esbuild.github.io/) dual-target compilation for rapid, standalone bundling.
* **Testing Suite:** [Jest](https://jestjs.io/) & `ts-jest` for automated unit and integration tests.

---

## 🌟 Capabilities & Features

* **⚡ Real-Time ACP State Sync:** Live indicator pill in the top HUD navbar reflecting real agent states (`Local CLI`, `Thinking...`, `⚡ [Skill Name]`, `Connecting...`, `Tool Executing`, `Disconnected`).
* **💬 Streaming Chat & Token Disclosure:** Live markdown rendering with syntax-highlighted code blocks, copy actions, and collapsible `<Thinking>` accordions with live millisecond timing counters.
* **⌨️ Floating Command Capsule:** Integrated model-switch picker dropdown, turn cancellation, and `/` slash-command palette.
* **📋 Persistent Session Management:** Segmented views for **Active** and **Archived** chats, instant SQLite search, session resumption, and safe deletion.
* **🧠 Zero-RAM On-Demand Skills:** Instant skill discovery directly from disk (`~/.hermes/skills/`) with visual badges for **🌟 Learned Skills** synthesized autonomously by Hermes.
* **🔄 Hot-Reload Configuration:** Built-in filesystem watcher detecting manual changes in `%LOCALAPPDATA%\hermes\config.yaml` and `.env` without requiring extension reloads.
* **🌐 Dynamic Language Switching:** Seamlessly toggle between Persian and English directly from Settings.

---

## 👤 User Guide: Installation & Usage

### Prerequisites
1. **Hermes CLI** installed on your system:
   ```powershell
   # Windows (PowerShell)
   irm https://hermes-agent.nousresearch.com/install.ps1 | iex
   ```
   ```bash
   # Linux / macOS / WSL
   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   ```
2. Run `hermes setup` in your terminal to configure LLM provider keys (OpenRouter, Anthropic, OpenAI, etc.).
3. **VS Code** 1.85.0 or later.

### Installation (VSIX)
Download `hermes-vscode-1.0.0.vsix` and install it:
```bash
code --install-extension hermes-vscode-1.0.0.vsix --force
```
*(Or in VS Code: Extensions view `Ctrl+Shift+X` → `...` menu → **Install from VSIX...**)*

> 💡 **Self-Contained Package:** End-users do **not** need Node.js or `npm` installed. The VSIX package contains all pre-compiled assets and dependencies.

### Daily Usage
1. Open the Hermes sidebar from the Secondary Sidebar or press `Ctrl+Alt+H`.
2. The extension automatically detects your Hermes CLI installation and connects to the ACP server.
3. Chat naturally, view tool executions, and trigger quick actions with slash commands (`/`):
   * `/new`: Start a fresh conversation session.
   * `/model`: Switch models or providers on the fly.
   * `/skills`: Pick and inject custom skills into prompt context.
   * `/approve`: Toggle tool execution auto-approval.

---

## 👨‍💻 Developer Guide: Setup, Build & Test

For contributors developing or compiling the extension from source:

### Prerequisites
* **Node.js** 18.x or 20.x
* **npm** (included with Node.js)
* **Python** 3.x

### Setup & Development Workflow
```bash
# 1. Clone repository
git clone https://github.com/AlirezaQasim/hermes-vscode-extention.git
cd hermes-vscode-extention

# 2. Install development dependencies (creates node_modules/)
npm install
# On Windows PowerShell if script execution is restricted:
npm.cmd install

# 3. Type-check TypeScript
npm.cmd run compile

# 4. Build extension host and Svelte webview bundles
node esbuild.config.js

# 5. Run automated test suite (31 tests)
node ./node_modules/jest/bin/jest.js

# 6. Package production VSIX
node ./node_modules/@vscode/vsce/vsce package --no-git-tag-version

# 7. Install your build locally in VS Code
code --install-extension hermes-vscode-1.0.0.vsix --force
```

---

## 📖 Configuration & Command Reference

### Settings (`hermes.*`)
Configure settings in VS Code Preferences (`Ctrl+,` → search "Hermes"):

| Setting | Default | Description |
|:---|:---|:---|
| `hermes.enabled` | `true` | Enable or disable the extension |
| `hermes.acpCommand` | `"hermes"` | Executable path/command (auto-discovered on Windows, macOS, Linux) |
| `hermes.acpArgs` | `["acp"]` | Command arguments passed to start the ACP server |
| `hermes.cwd` | `"${workspaceFolder}"` | Working directory for agent tool operations |
| `hermes.autoApprovePermissions` | `false` | Automatically approve tool execution requests |
| `hermes.showTokenUsage` | `true` | Display real-time token metrics in the status bar |
| `hermes.streamingEnabled` | `true` | Enable live token streaming |
| `hermes.skillsPath` | `"~/.hermes/skills"` | Path to the custom skills directory |
| `hermes.logLevel` | `"info"` | Logging verbosity (`debug`, `info`, `warn`, `error`) |

### Keyboard Shortcuts
| Command | Keybinding | Description |
|:---|:---|:---|
| `hermes.connect` | `Ctrl+Alt+H` | Connect to local Hermes ACP client |
| `hermes.newSession` | `Ctrl+Alt+N` | Start a new session |
| `hermes.cancelTurn` | `Ctrl+Alt+C` | Cancel the running generation / tool call |

---

## 🏆 Release Highlights (v1.0.0)

* **Svelte Architecture Rewrite:** Replaced monolithic legacy scripts with a modern, modular Svelte SPA and reactive state stores.
* **Obsidian-Gold Design System:** Complete Figma-grade visual overhaul with polished dark glassmorphism and gold accents.
* **Real-Time ACP Status Engine:** Synchronized agent thinking, skill writing, and tool calls with top HUD capsules.
* **Event-Driven Hot-Reload Watcher:** Auto-detection of external `config.yaml` and `.env` edits without restarting.
* **Full Bilingual Support:** Native Persian (RTL) & English (LTR) language support with one-click toggling.
* **SQLite Session Storage:** Fast session restoration, active/archived separation, and search.
* **Verified Quality:** 100% test pass rate across 7 test suites (31 unit tests).

---

## License

This project is licensed under the [MIT License](LICENSE.txt).

Developed with ❤️ for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) ecosystem.
