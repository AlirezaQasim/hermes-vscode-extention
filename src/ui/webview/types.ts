export type TabId = 'chat' | 'sessions' | 'skills' | 'models' | 'settings';

export interface AttachmentItem {
    id: string;
    name: string;
    path?: string;
    size?: number;
    type: 'image' | 'file';
    mimeType?: string;
    data?: string; // base64 data for images
    content?: string; // text content for files
}

export interface ProjectFolderItem {
    name: string;
    path: string;
    isRoot: boolean;
}

export interface ToolCallStep {
    id: string;
    name: string;
    args: any;
    kind?: string;
    status: 'running' | 'done' | 'error';
    title?: string;
    result?: any;
    error?: string;
    isSkill?: boolean;
    skillName?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: string | Date;
    toolCalls?: ToolCallStep[];
    thinking?: string;
    displayKind?: string;
    attachments?: AttachmentItem[];
    errorMessage?: string;
    errorCode?: string;
}

export interface HermesSession {
    id: string;
    title?: string;
    model?: string;
    cwd?: string;
    messageCount: number;
    createdAt: number;
    updatedAt: number;
    source?: string;
    archived?: boolean;
}

export interface SkillInfo {
    name: string;
    description: string;
    category: string;
    path: string;
    dirPath: string;
    isLearned?: boolean;
}

export interface ModelProviderInfo {
    id: string;
    name: string;
    envVar: string;
    hasKey: boolean;
    keyMasked: string;
    baseUrl: string;
    docUrl: string;
    models: Array<{
        id: string;
        name: string;
        tag: string;
    }>;
}

export interface ModelConfigData {
    current: {
        provider: string;
        model: string;
        baseUrl: string;
        reasoningEffort?: string;
    };
    providers: ModelProviderInfo[];
}

export interface ExtensionConfig {
    autoApprove: boolean;
    cwd: string;
}

export interface HostUpdateMessage {
    type: 'update';
    activeTab?: TabId;
    messages?: ChatMessage[];
    connected?: boolean;
    sessionId?: string | null;
    sessionTitle?: string;
    tokenUsage?: { prompt: number; completion: number; total: number } | null;
    modelConfig?: ModelConfigData | null;
    sessions?: HermesSession[];
    skills?: SkillInfo[];
    config?: ExtensionConfig;
}

export type WebviewToHostMessage =
    | { type: 'sendPrompt'; text: string; attachments?: AttachmentItem[] | undefined }
    | { type: 'cancelTurn' }
    | { type: 'newSession' }
    | { type: 'clearChat'; sessionId?: string }
    | { type: 'openSkillFile'; skillPath: string }
    | { type: 'loadSession'; sessionId: string }
    | { type: 'archiveSession'; sessionId: string; archive: boolean }
    | { type: 'deleteSession'; sessionId: string }
    | { type: 'switchTab'; tab: TabId }
    | { type: 'saveModelConfig'; provider: string; model: string; apiKey?: string; baseUrl?: string; reasoningEffort?: string }
    | { type: 'updateReasoningEffort'; effort: string }
    | { type: 'transcribeVoice'; audioData: string; mimeType: string }
    | { type: 'startVoiceRecording' }
    | { type: 'stopVoiceRecording' }
    | { type: 'refreshData' }
    | { type: 'reconnect' }
    | { type: 'runSetupTerminal' }
    | { type: 'pickAttachment' }
    | { type: 'getProjectFolders' }
    | { type: 'setCwd'; cwd: string }
    | { type: 'updateSetting'; key: string; value: any };
