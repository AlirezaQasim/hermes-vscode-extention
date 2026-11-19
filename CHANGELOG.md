# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-11-19

### Fixed
- **SQLite Trigger Deletion Guard:** Fixed error `Refused to delete a session that has gateway runtime history` caused by SQLite trigger `sessions_runtime_ledger_delete_guard` firing when deleting sessions. Explicitly cascades deletions through `session_admissions` (`target_session_id`), `worker_executions` (`session_id`), `messages`, and gateway ledger tables before safely removing sessions.
- **Permanent Session Deletion & Chat Clear:** Ensures physical deletion of sessions and all associated messages from `state.db` when deleting from Sessions tab (Active & Archived) or clearing history from the Chat tab, preventing session resurrection upon resume or reload.
- **Daemon Lifecycle Synchronization:** Terminated stale Python daemon instances during extension initialization and reload, ensuring up-to-date database handlers execute without IPC protocol mismatch.

## [1.0.3] - 2026-11-19

### Fixed
- **Session Deletion & Database Locking:** Fixed SQLite file locking issue in `hermesDb.py` and persistent daemon IPC where unclosed database connections prevented deletions (`database is locked`), causing session deletion failures in Active and Archived tabs. Added dynamic multi-table cascading cleanup and seamless CLI execution fallback.
- **Clear Chat Confirmation Modal:** Added a mandatory confirmation dialog to the Clear Chat button (🧹) in CommandCapsule with clear warning of irreversibility before any clearing occurs.
- **Permanent Chat Reset:** Resolved ghost session resurrection where cleared conversations could be reloaded from the Sessions tab. Clearing chat history now permanently deletes past messages from the database and initializes a fresh, isolated session ID.
- **Daemon IPC Responsiveness:** Switched Python daemon from buffered `for line in sys.stdin` to unbuffered `sys.stdin.readline()`, ensuring immediate line-by-line processing without pipe buffering latency.

## [1.0.2] - 2026-11-14

### Fixed
- **API Key Persistence:** Fixed duplicate `OPENROUTER_API_KEY` entries in `.env` and updated configuration updater to prune all previous duplicates, ensuring new keys persist and display correctly with updated masked tags.
- **OpenRouter Model Catalog & Free Tier Filter:** Added Hermes curated static models to OpenRouter model list, ensuring free models like `nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3.5-lightning:free`, and others are indexed, categorized, and visible when the Free Tier filter is active.
- **Dynamic Model Selection:** Automatically snaps model selection to valid options upon changing operators or filters, preventing empty model select fields.
- **Conditional Skill Learning Card:** Fixed the purple learning card ("از این پروژه یاد می‌گیرم") so it only appears when the agent is actively learning or writing a skill, rather than unconditionally on every assistant response.

## [1.0.1] - 2026-11-14

### Added
- Native voice notes and audio recording pipeline with PowerShell engine and Google Gemini STT integration
- Direct sync with authoritative Hermes registry (`models_dev_cache.json`) for exact live models per provider (including all 19 native Google Gemini models)
- Reasoning effort level selection integrated with `config.yaml` and live ACP prompt parameters
- Real-time token and thought streaming with millisecond responsiveness
- Responsive multi-row layout for command capsule controls across compact screens and sidebars

### Fixed
- Fixed model list discrepancy where Google AI Studio displayed OpenRouter catalog entries
- Fixed turn hang and perpetual thinking timer when submitting voice notes or encountering API failures
- Fixed `base_url` contamination when switching from aggregator providers to native API endpoints
- Fixed button collision and overlapping in CommandCapsule on narrow screens
- Fixed icon differentiation between Model Switcher and New Chat buttons
- Fixed auto-approve permission bypass for file operations and workspace editing

## [1.0.0] - 2026-09-18

### Added
- Initial release of Hermes Agent VS Code Extension
- Full ACP (Agent Client Protocol) integration with Hermes Agent
- Rich chat webview with streaming markdown rendering
- Session management (create, load, list, fork, delete)
- Skills tree view with category organization
- Tools tree view showing available Hermes tools
- Status bar with connection status, token usage, mode, auto-approve indicator
- Slash command support with grouped menu
- File system integration (read, write, edit, delete, search)
- Terminal integration for command execution
- Permission handling with approval dialogs
- Model and provider switching
- Token usage tracking with visual warnings
- Queue and interrupt support for concurrent prompts
- Configuration via VS Code settings
- Keybindings for common actions
- Multi-platform support (Windows, macOS, Linux)

### Features
- Streaming responses with real-time updates
- Tool call visualization with status indicators
- Thinking/reasoning display
- Image rendering from Hermes MEDIA protocol
- Copy buttons on code blocks
- Syntax highlighting in chat
- Session persistence across reloads
- Skills multi-select injection
- Auto-approve permissions toggle
- Comprehensive command palette integration

## [Unreleased]

### Planned
- MCP server configuration UI
- Custom theme/skin support
- Pet mascot integration
- Voice input/output support
- Web dashboard integration
- Bot mode UI
- Collaborative session sharing
- Advanced permission policies
- Export/import sessions
- Workspace-specific configurations