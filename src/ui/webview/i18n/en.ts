export const en: Record<string, string> = {
    // Brand & HUD
    'brand.title': 'HERMES',
    'brand.subtitle': 'LOCAL AGENT',
    'status.connected': 'Local CLI',
    'status.disconnected': 'Offline / Disconnected',
    'status.connecting': 'Connecting...',

    // Tabs
    'tab.chat': 'Chat',
    'tab.sessions': 'Sessions',
    'tab.skills': 'Skills',
    'tab.models': 'Models & Settings',

    // Disconnected Banner
    'banner.title': 'Hermes CLI is not connected',
    'banner.desc': 'To start using the autonomous agent, run the setup wizard or click below.',
    'banner.action': 'Run Setup (hermes setup)',

    // Mission Hub / Hero Dial
    'hero.badge': 'Nous Research Autonomous Agent',
    'hero.title': 'Hermes is Ready for Mission',
    'hero.subtitle': 'Start a conversation or trigger a suggested mission below:',

    // Mission Cards
    'mission.code.title': 'Inspect & Debug Code',
    'mission.code.desc': 'Scan open workspace files and resolve potential errors or bugs.',
    'mission.refactor.title': 'Enterprise Refactor',
    'mission.refactor.desc': 'Refactor workspace code following Clean Architecture and modular patterns.',
    'mission.skills.title': 'Inspect Learned Skills',
    'mission.skills.desc': 'Browse autonomous and built-in skills directly loaded from SSD.',
    'mission.terminal.title': 'Run Terminal Commands',
    'mission.terminal.desc': 'Execute build, test, and packaging scripts safely in the terminal.',

    // Chat Composer
    'composer.placeholder': 'Type instructions or type / for quick commands... (Enter)',
    'composer.timer': 'Responding...',
    'composer.hint': 'Enter ↵',
    'composer.send': 'Send Message',
    'composer.stop': 'Stop Generation',
    'composer.selectModel': 'Switch Model',

    // Command Palette
    'palette.title': 'Quick Commands',
    'palette.close': 'ESC to close',
    'cmd.new.desc': 'Start a fresh conversation with clean context',
    'cmd.model.desc': 'Switch AI operator or active model',
    'cmd.skills.desc': 'Browse skills loaded from disk',
    'cmd.approve.desc': 'Toggle auto-approve tool permissions',
    'cmd.reconnect.desc': 'Reconnect client to local Hermes ACP',

    // Live Tools
    'tools.timeline': 'Live Execution Timeline',
    'tools.running': 'Running...',
    'tools.done': 'Done',
    'tools.error': 'Failed',
    'tools.thinking': 'Hermes Thought Process',

    // Sessions Panel
    'sessions.title': 'Past Conversations',
    'sessions.new': 'New Session',
    'sessions.refresh': 'Refresh',
    'sessions.filter.active': 'Active',
    'sessions.filter.archived': 'Archived',
    'sessions.filter.all': 'All Sessions',
    'sessions.search': 'Search sessions by title or model...',
    'sessions.empty': 'No sessions found.',
    'sessions.resume': 'Resume Session',
    'sessions.archive': 'Archive',
    'sessions.unarchive': 'Unarchive',
    'sessions.delete': 'Delete',
    'sessions.emptyArchived': 'No archived conversations found.',
    'sessions.newStarted': 'New conversation started',
    'sessions.refreshed': 'Conversations list refreshed',
    'sessions.messagesCount': 'messages',
    'sessions.view': 'View',

    // Time Ago
    'time.justNow': 'just now',
    'time.minsAgo': 'mins ago',
    'time.hoursAgo': 'hours ago',
    'time.daysAgo': 'days ago',

    // Skills Panel
    'skills.title': 'Hermes Skills',
    'skills.refresh': 'Refresh Disk',
    'skills.refreshed': 'Skills reloaded from SSD',
    'skills.desc': 'Skills loaded on-demand directly from SSD (Zero RAM footprint).',
    'skills.search': 'Search skills by name, category or description...',
    'skills.empty': 'No skills matching query.',
    'skills.learned': 'Learned by Agent',
    'skills.builtin': 'Built-in Skill',
    'skills.useInChat': 'Use in Chat',
    'skills.openFile': 'Open SKILL.md',

    // Settings & Recovery
    'settings.title': 'Settings & System Recovery',
    'settings.desc': 'Manage local agent connection, auto-approve permissions, environment paths, and interface language.',
    'settings.reconnecting': 'Reconnecting Hermes ACP...',
    'settings.reconnected': 'Hermes connection established successfully',

    // Models Panel
    'models.title': 'Models & Inference Operators',
    'models.desc': 'Configure LLM operators, API keys, and active models graphically without terminal or manual YAML editing.',
    'models.activeTag': 'Active Model',
    'models.operatorLabel': '1. Operator / Provider:',
    'models.apiKeyLabel': '2. API Key:',
    'models.apiKeySaved': 'Saved securely to local disk (%LOCALAPPDATA%\\hermes\\.env)',
    'models.modelLabel': '3. Model Selection:',
    'models.customCheck': 'Enter custom model ID manually',
    'models.applyBtn': 'Apply & Start New Chat',
    'models.reconnectBtn': 'Reconnect Hermes ACP',
    'models.terminalSetupBtn': 'Run "hermes setup" in Terminal',
    'models.autoApprove': 'Auto-Approve Tool Permissions',
    'models.autoApproveDesc': 'Execute tools and file edits directly without asking for confirmation every turn.',
    'models.langLabel': 'Interface Language:',
    'models.langFa': 'فارسی (RTL)',
    'models.langEn': 'English (LTR)',

    // Modals & Confirmations
    'modal.confirmTitle': 'Confirm Action',
    'modal.cancel': 'Cancel',
    'modal.confirm': 'Confirm',
    'modal.deleteSession': 'Are you sure you want to permanently delete this session? Messages cannot be recovered.',
    'modal.archiveSession': 'Are you sure you want to archive this session?',

    // Footer Bar
    'footer.agent': 'HERMES / v1.0.0',
    'footer.tagline': 'Local. Autonomous. Under Your Control.'
};
