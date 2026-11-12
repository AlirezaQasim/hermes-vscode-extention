# Hermes Agent VS Code Extension

[![Version](https://img.shields.io/badge/version-1.0.0-gold.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.txt)
[![ACP Protocol](https://img.shields.io/badge/Protocol-ACP%20v1-emerald.svg)](https://agentclientprotocol.com/)
[![Built with Svelte](https://img.shields.io/badge/Frontend-Svelte%204-orange.svg)](https://svelte.dev/)

The official Visual Studio Code extension for [Hermes Agent](https://github.com/NousResearch/hermes-agent) (by Nous Research) — the autonomous, self-improving AI agent featuring persistent memory, skills synthesis, and multi-platform messaging gateway.

The extension connects to Hermes Agent via the native **Agent Client Protocol (ACP)** over stdio with bidirectional JSON-RPC 2.0 streaming, driven by a modern **Svelte Reactive Single-Page Application (SPA)** following the Obsidian-Gold design system.

---

## Architecture Overview

The extension is designed around an asynchronous, event-driven decoupling of the UI, backend services, and ACP subprocess:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       VS Code Extension Host                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │               Svelte Webview SPA (Obsidian-Gold UI)             │   │
│   │  ┌──────────────┐ ┌──────────────┐ ┌───────────┐ ┌───────────┐  │   │
│   │  │  Chat Tab    │ │ Sessions Tab │ │Skills Tab │ │SettingsTab│  │   │
│   │  └──────┬───────┘ └──────┬───────┘ └─────┬─────┘ └─────┬─────┘  │   │
│   │         └────────────────┼───────────────┼─────────────┘        │   │
│   │                          ▼                                      │   │
│   │             Reactive Stores (Svelte Writable)                   │   │
│   │         [chatStore, sessionStore, skillStore, uiStore]          │   │
│   │                          │                                      │   │
│   │        BiDi Engine (English LTR ⮂ Persian RTL فارسی)            │   │
│   └──────────────────────────┼──────────────────────────────────────┘   │
│                              │ postMessage / onDidReceiveMessage        │
│                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                     ChatViewProvider                            │   │
│   │                   (Host & State Bridge)                         │   │
│   └──────────┬───────────────────────┬──────────────────────┬───────┘   │
│              │                       │                      │           │
│              ▼                       ▼                      ▼           │
│   ┌──────────────────────┐┌──────────────────────┐┌──────────────────┐  │
│   │    ConfigService     ││    SessionService    ││   SkillService   │  │
│   │ (Hot-Reload Watcher) ││ (SQLite / hermesDb)  ││ (SSD Zero-RAM)  │  │
│   └──────────┬───────────┘└──────────┬───────────┘└─────────┬────────┘  │
│              │                       │                      │           │
│              └───────────────────────┼──────────────────────┘           │
│                                      ▼                                  │
│                         ┌──────────────────────────┐                    │
│                         │     HermesACPClient      │                    │
│                         │  (JSON-RPC 2.0 / stdio)  │                    │
│                         └────────────┬─────────────┘                    │
└──────────────────────────────────────┼──────────────────────────────────┘
                                       ▼ (child_process.spawn)
                 ┌──────────────────────────────────────────┐
                 │          hermes acp (Subprocess)         │
                 │   - Autonomous Tool Execution            │
                 │   - Real-time Thinking & Streaming       │
                 │   - Skills Creation & Adaptive Learning  │
                 │   - Multi-Provider LLM Gateway           │
                 └──────────────────────────────────────────┘
```

---

## Key Features

### 💎 Modern Reactive Frontend (Svelte + Obsidian-Gold Design)
- **High-Performance Svelte SPA:** Sub-millisecond rendering with zero virtual-DOM overhead.
- **Obsidian-Gold Design System:** Deep dark aesthetic (`#0c0f17`), gold accents (`#f5b942`), subtle glassmorphism, and responsive layouts.
- **HUD Navbar (`HudNavbar.svelte`):** Live reactive status pill indicating agent activity in real-time:
  - `Local CLI` (Connected & Idle)
  - `Thinking...` (Deep-reasoning with pulsing gold indicator)
  - `⚡ [Skill Name]` (Real-time autonomous skill synthesis)
  - `Connecting...` (ACP handshake in progress)
  - `Tool Executing` (Active tool invocation)
- **Fluid Chat Timeline:** Seamless vertical scrolling, auto-scroll with manual scroll-lock detection, and Markdown rendering with code syntax highlighting and one-click copy.
- **Floating Input Capsule (`CommandCapsule.svelte`):** Integrated model switch dropdown, quick action menu, and `/` Slash-Command palette.
- **Thinking / Reasoning Disclosure:** Collapsible `<Thinking>` accordion with live millisecond timing counter and streaming reasoning tokens.

### 🌐 Full Internationalization (i18n & BiDi)
- Native bilingual support: **English (LTR)** & **فارسی / Persian (RTL)**.
- Real-time language switcher in the Settings tab with persistent user preference.
- Proper bidirectional text isolation (`unicode-bidi: plaintext`) across messages, cards, and input fields.

### 🔄 Event-Driven Hot-Reload Configuration (`ConfigService`)
- Integrated `vscode.workspace.createFileSystemWatcher` monitoring:
  - `%LOCALAPPDATA%\hermes\config.yaml` / `~/.hermes/config.yaml`
  - `%LOCALAPPDATA%\hermes\.env` / `~/.hermes/.env`
- External edits made in Notepad or any editor instantly invalidate cache and update the extension UI without requiring an extension or VS Code reload.

### 🗄️ Real SQLite Session Persistence (`SessionService`)
- Direct integration with Hermes's SQLite database via Python bridge (`src/utils/hermesDb.py`).
- **Active & Archived Tabs:** Easily separate current missions from archived history.
- **Instant Search:** Filter conversations by title, model, or session ID in real-time.
- **Safety Confirmations:** Modern modal confirmation for session deletion with color-coded hover actions.

### ⚡ Zero-RAM On-Demand Skills (`SkillService`)
- Discovers skills directly from disk (`~/.hermes/skills/`).
- Distinguishes standard built-in skills from **🌟 Learned Skills** (skills synthesized autonomously by Hermes).
- One-click **Use in Chat** (injects advisory skill prompt) and **Open SKILL.md** in VS Code editor.

---

## Installation & Requirements

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
2. Run `hermes setup` in your terminal to configure LLM providers (OpenRouter, Anthropic, OpenAI, etc.).
3. **VS Code** 1.85.0 or later.

### Install from VSIX
Download the latest `hermes-vscode-1.0.0.vsix` and run:
```bash
code --install-extension hermes-vscode-1.0.0.vsix --force
```

---

## Configuration Settings

All configurations are located under the `hermes.*` namespace in VS Code Settings (`Ctrl+,`):

| Setting | Default | Description |
|:---|:---|:---|
| `hermes.enabled` | `true` | Enable or disable the Hermes extension |
| `hermes.acpCommand` | `"hermes"` | Path or command for the Hermes executable (auto-discovered) |
| `hermes.acpArgs` | `["acp"]` | Command arguments passed to start the ACP server |
| `hermes.cwd` | `"${workspaceFolder}"` | Working directory for the agent execution |
| `hermes.autoApprovePermissions` | `false` | Automatically approve tool execution requests |
| `hermes.showTokenUsage` | `true` | Display real-time token metrics in the status bar |
| `hermes.streamingEnabled` | `true` | Enable live token streaming |
| `hermes.maxHistory` | `100` | Maximum messages preserved in memory per session |
| `hermes.skillsPath` | `"~/.hermes/skills"` | Path to the skills directory |
| `hermes.logLevel` | `"info"` | Output log level (`debug`, `info`, `warn`, `error`) |

### Auto-Discovery Paths
The extension automatically discovers your Hermes executable without manual configuration:
- **Windows:** `%LOCALAPPDATA%\hermes\bin\hermes.cmd` or `%LOCALAPPDATA%\Programs\hermes\bin\hermes.cmd`
- **Linux/macOS:** `~/.local/bin/hermes` or `~/.hermes/bin/hermes`
- **System PATH:** Fallback to any executable found in your environment `PATH`.

---

## Commands & Shortcuts

| Command | Shortcut | Description |
|:---|:---|:---|
| `hermes.connect` | `Ctrl+Alt+H` | Connect to the local Hermes ACP client |
| `hermes.disconnect` | — | Disconnect from the ACP server |
| `hermes.newSession` | `Ctrl+Alt+N` | Start a new clean session |
| `hermes.openChat` | — | Focus the Hermes Chat panel |
| `hermes.cancelTurn` | `Ctrl+Alt+C` | Abort current agent generation/tool call |
| `hermes.switchModel` | — | Open model selector palette |
| `hermes.toggleAutoApprove` | — | Toggle tool execution auto-approval |
| `hermes.runSetup` | — | Launch `hermes setup` in an integrated terminal |

---

## Developer Guide & Build Instructions

### Project Structure
```
Hermes-VS-Extension/
├── esbuild.config.js          # Dual bundler (Extension host + Svelte webview)
├── package.json               # Manifest, dependencies, and extension contributions
├── tsconfig.json              # TypeScript compilation configuration
├── src/
│   ├── extension.ts           # Extension entry point & lifecycle coordinator
│   ├── acp/                   # Agent Client Protocol client & JSON-RPC parser
│   ├── config/                # Configuration schema and path resolvers
│   ├── handlers/              # Permission, terminal, and session managers
│   ├── services/              # Core business services
│   │   ├── ConfigService.ts   # Hot-reload filesystem watcher
│   │   ├── SessionService.ts  # SQLite query integration
│   │   └── SkillService.ts    # On-demand disk skill loader
│   ├── ui/                    # UI layer & webview provider
│   │   ├── chatView.ts        # WebviewViewProvider host bridge
│   │   ├── chatView.css       # Obsidian-Gold global styles
│   │   └── webview/           # Modern Svelte SPA source
│   │       ├── main.ts        # Svelte bootstrap mount
│   │       ├── components/    # Svelte UI components (HUD, Chat, Panels)
│   │       ├── state/         # Svelte reactive stores
│   │       └── i18n/          # English & Persian localization dictionaries
│   └── utils/                 # Logging, path finding, and Python SQLite helper
└── test/                      # Comprehensive Jest test suite
```

### Build Commands
```bash
# 1. Install dependencies
npm.cmd install

# 2. Compile TypeScript
npm.cmd run compile

# 3. Build bundle with esbuild (Extension + Svelte Webview)
node esbuild.config.js

# 4. Run test suite
node ./node_modules/jest/bin/jest.js

# 5. Package as VSIX
node ./node_modules/@vscode/vsce/vsce package --no-git-tag-version

# 6. Install locally in VS Code
code --install-extension hermes-vscode-1.0.0.vsix --force
```

---

## License

This project is licensed under the **MIT License** — see the [LICENSE.txt](LICENSE.txt) file for details.

Developed with ❤️ for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) ecosystem.
