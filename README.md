# Hermes Agent VS Code Extension

[![Version](https://img.shields.io/badge/version-1.0.0-gold.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.txt)
[![ACP Protocol](https://img.shields.io/badge/Protocol-ACP%20v1-emerald.svg)](https://agentclientprotocol.com/)
[![Built with Svelte](https://img.shields.io/badge/Frontend-Svelte%204-orange.svg)](https://svelte.dev/)
[![Jest Tests](https://img.shields.io/badge/Tests-31%20Passed-brightgreen.svg)](test/)

The official Visual Studio Code extension for [Hermes Agent](https://github.com/NousResearch/hermes-agent) (by Nous Research) — the autonomous, self-improving AI agent featuring persistent memory, skills synthesis, and multi-platform messaging gateway.

The extension connects to Hermes Agent via the native **Agent Client Protocol (ACP)** over stdio with bidirectional JSON-RPC 2.0 streaming, driven by a fully modular **Svelte Reactive Single-Page Application (SPA)** following the Obsidian-Gold design system.

---

## Technical Architecture & Modular Design

The extension has been rearchitected from the ground up into three strictly decoupled, modular layers:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       VS Code Extension Host                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                 1. MODULAR SVELTE FRONTEND SPA                  │   │
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
│   │             ChatViewProvider (Host & State Bridge)              │   │
│   └──────────┬───────────────────────┬──────────────────────┬───────┘   │
│              │                       │                      │           │
│              ▼                       ▼                      ▼           │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                 2. BACKEND SERVICES LAYER                       │   │
│   │  ┌──────────────────────┐┌──────────────────────┐┌───────────┐  │   │
│   │  │    ConfigService     ││    SessionService    ││SkillServ. │  │   │
│   │  │ (Hot-Reload Watcher) ││ (SQLite / hermesDb)  ││(Zero-RAM) │  │   │
│   │  └──────────────────────┘└──────────────────────┘└───────────┘  │   │
│   │  ┌───────────────────────────────────────────────────────────┐  │   │
│   │  │ Handlers: PermissionHandler, TerminalHandler, SessionMgr  │  │   │
│   │  └───────────────────────────────────────────────────────────┘  │   │
│   └──────────────────────────────────┬──────────────────────────────┘   │
│                                      │                                  │
│                                      ▼                                  │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │           3. AGENT CLIENT PROTOCOL (ACP) ENGINE                 │   │
│   │          HermesACPClient (JSON-RPC 2.0 / stdio)                 │   │
│   │     [Lifecycle States: Idle, Thinking, Tool, Writing Skill]     │   │
│   └──────────────────────────────────┬──────────────────────────────┘   │
└──────────────────────────────────────┼──────────────────────────────────┘
                                       ▼ (child_process.spawn)
                 ┌──────────────────────────────────────────┐
                 │          hermes acp (Subprocess)         │
                 │   - Autonomous Tool Execution            │
                 │   - Real-time Thinking & Token Streaming │
                 │   - Skills Creation & Adaptive Learning  │
                 │   - Multi-Provider LLM Gateway           │
                 └──────────────────────────────────────────┘
```

---

### 1. Frontend Modular Breakdown (`src/ui/webview/`)

The webview runs as an independent Single-Page Application (SPA) built with Svelte 4, completely separated from the extension host:

* **Component Hierarchy:**
  * `App.svelte`: Root shell orchestrating the active panel views and global event listeners.
  * `HudNavbar.svelte`: Top HUD status bar providing live reactive state pills (`Local CLI`, `Thinking...`, `⚡ [Skill Name]`, `Connecting...`, `Tool Executing`, `Disconnected`).
  * `MissionHub.svelte`: Onboarding mission hub displaying pre-configured quick tasks when starting a clean session.
  * `ChatTimeline.svelte`: Fluid message stream with syntax-highlighted code blocks, one-click copy, interactive tool calls, and collapsible `<Thinking>` accordions with live millisecond elapsed timers.
  * `CommandCapsule.svelte`: Obsidian-Gold floating prompt capsule with integrated model-switch picker dropdown, quick actions, and submit trigger.
  * `CommandPalette.svelte`: Slash-command popup dialog triggered by `/` with keyboard navigation (`/new`, `/model`, `/skills`, `/approve`, `/reset`, etc.).
  * `SessionsPanel.svelte`: Past conversations view with segmented filters (**Active** vs **Archived**), SQLite real-time search, one-click resumption, archive/restore toggle, and delete safety modal.
  * `SkillsPanel.svelte`: On-demand disk skills explorer with category tags, **🌟 Learned Skill** badges, live disk refresh (`↻`), `Open SKILL.md`, and `Use in Chat` actions.
  * `ModelsPanel.svelte`: LLM provider/model configuration card, API key manager, Hermes system recovery, auto-approve permissions toggle, and bilingual language capsule.

* **Reactive State Stores (`src/ui/webview/state/`):**
  * `chatStore.ts`: Active conversation messages, streaming tokens, turn cancellation, and execution timer.
  * `sessionStore.ts`: Session records, active/archived state, and instant search query filter.
  * `skillStore.ts`: Available skill metadata, disk refresh state, and prompt injection triggers.
  * `modelStore.ts`: Configured providers, model catalogs, active model selection, and API credentials.
  * `uiStore.ts`: Active tab selection, ACP connection status, agent activity metrics, and toast notifications.

* **BiDi Internationalization Engine (`src/ui/webview/i18n/`):**
  * `fa.ts`: Complete Persian translation with native Right-to-Left (RTL) typography and styling.
  * `en.ts`: Complete English translation with Left-to-Right (LTR) typography.
  * `index.ts`: Reactive dictionary provider with `t(key)` helper and `unicode-bidi: plaintext` isolation.

---

### 2. Backend Services Layer (`src/services/`)

Decoupled business logic services running in the VS Code Extension Host:

* **`ConfigService.ts` (Hot-Reload File Watcher):**
  * Operates a `vscode.workspace.createFileSystemWatcher` monitoring `%LOCALAPPDATA%\hermes\config.yaml` and `.env` (or `~/.hermes/`).
  * When configuration or API keys are edited externally (e.g. via Notepad or terminal), the service immediately invalidates the cache and notifies the UI in real-time without requiring an extension or VS Code reload.
* **`SessionService.ts` (SQLite Database Integration):**
  * Connects to the local Hermes SQLite database (`hermesDb.py`).
  * Provides session listing, message history retrieval, archiving, restoring, and safe deletion.
* **`SkillService.ts` (Zero-RAM On-Demand Loader):**
  * Discovers skills directly from disk (`~/.hermes/skills/`).
  * Parses frontmatter and markdown descriptions dynamically on request with zero continuous RAM overhead.
* **Auxiliary Handlers (`src/handlers/`):**
  * `permissionHandler.ts`: Intercepts tool calls and requests user permission or applies auto-approval.
  * `terminalHandler.ts`: Launches CLI operations (e.g., `hermes setup`) in the integrated VS Code terminal.
  * `fileSystemHandler.ts`: Automatically opens or previews workspace files referenced by the agent.

---

### 3. Agent Client Protocol (ACP) Engine (`src/acp/`)

* **`client.ts` (HermesACPClient):**
  * Implements the native Agent Client Protocol (JSON-RPC 2.0) over standard input/output (`stdio`).
  * Spawns and manages the `hermes acp` process.
  * Dispatches structured events to the extension host:
    * `sessionUpdate`: Live streaming tokens and message updates.
    * `toolCall`: Tool execution notifications with parameters and live output.
    * `permissionRequest`: Tool permission approval handshakes.
    * `tokenUsage`: Real-time token consumption metrics.
  * **Activity State Machine:** Synchronizes the agent's real-time internal state (`idle` → `thinking` → `writing_skill` → `tool` → `streaming` → `disconnected`) with the HUD navbar and UI capsules.

---

## Understanding Dependencies: User Installation vs. Development

A common question when installing or developing VS Code extensions:

### 📦 For End Users (Installing the Extension)
> **Do end-users need Node.js, npm, or `node_modules` installed?**
> **NO.** End users do **NOT** need Node.js or `node_modules`.

When the extension is packaged into a `.vsix` file using `vsce package`:
1. `esbuild` automatically bundles all TypeScript, Svelte components, and runtime dependencies (like Svelte runtime, marked, uuid) into two standalone JavaScript bundles:
   - `out/extension.js` (Extension Host)
   - `out/ui/chatView.js` (Webview SPA)
2. All CSS, icons, and assets are packaged directly inside `hermes-vscode-1.0.0.vsix`.
3. VS Code runs the extension using its own built-in Electron/Node.js runtime.

**User Requirements:**
* VS Code 1.85.0+
* Hermes CLI installed on your operating system (`hermes`)
* Python 3.x (used for SQLite database queries)

---

### 💻 For Developers (Building from Source)
> **Do developers need `node_modules`?**
> **YES.** Anyone cloning the source code to build, test, or modify the extension needs the development environment.

`node_modules/` is intentionally excluded from Git via `.gitignore` (standard practice in software development to keep repository size lean and avoid committing OS-specific native binaries).

**Developer Requirements:**
* Node.js 18.x or 20.x
* npm (bundled with Node.js)
* Python 3.x
* Hermes CLI

```bash
# 1. Clone the repository
git clone https://github.com/AlirezaQasim/hermes-vscode-extention.git
cd hermes-vscode-extention

# 2. Install all dependencies (creates node_modules/)
npm install
# On Windows PowerShell, if execution policy restricts npm:
npm.cmd install

# 3. Compile TypeScript
npm.cmd run compile

# 4. Bundle with esbuild (Extension Host + Svelte Webview)
node esbuild.config.js

# 5. Run test suite (All 31 Jest tests)
node ./node_modules/jest/bin/jest.js

# 6. Package into a VSIX extension
node ./node_modules/@vscode/vsce/vsce package --no-git-tag-version

# 7. Install into VS Code
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

## License

This project is licensed under the **MIT License** — see the [LICENSE.txt](LICENSE.txt) file for details.

Developed with ❤️ for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) ecosystem.
