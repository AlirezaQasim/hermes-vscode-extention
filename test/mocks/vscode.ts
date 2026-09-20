// Mock vscode module for testing
export const window = {
    createStatusBarItem: jest.fn(() => ({
        show: jest.fn(),
        dispose: jest.fn(),
        text: '',
        tooltip: '',
        color: undefined,
        backgroundColor: undefined,
        command: ''
    })),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    createTerminal: jest.fn(() => ({
        show: jest.fn(),
        sendText: jest.fn(),
        dispose: jest.fn(),
        name: ''
    })),
    onDidCloseTerminal: jest.fn(() => ({ dispose: jest.fn() })),
    onDidWriteTerminalData: jest.fn(() => ({ dispose: jest.fn() })),
    activeTextEditor: undefined,
    registerWebviewViewProvider: jest.fn(),
    registerTreeDataProvider: jest.fn(),
    createTreeView: jest.fn()
};

export const workspace = {
    getConfiguration: jest.fn(() => ({
        get: jest.fn((key: string, defaultValue: any) => defaultValue),
        update: jest.fn()
    })),
    workspaceFolders: [{
        uri: { fsPath: '/test/workspace' }
    }],
    fs: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        delete: jest.fn(),
        readDirectory: jest.fn()
    },
    openTextDocument: jest.fn(),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() }))
};

export const commands = {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
    executeCommand: jest.fn(),
    getCommands: jest.fn()
};

export const Uri = {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
    joinPath: jest.fn((base: any, ...paths: string[]) => ({ fsPath: paths.join('/') }))
};

export const ThemeIcon = jest.fn();
export const ThemeColor = jest.fn();
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const TreeItemCollapsibleState = { None: 0, Expanded: 1, Collapsed: 2 };
export class EventEmitter<T> {
    private listeners: ((data: T) => void)[] = [];
    event = (listener: (data: T) => void) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire(data?: T) { this.listeners.forEach(l => l(data!)); }
}
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const ExtensionContext = jest.fn();
export const ViewColumn = { One: 1, Two: 2, Three: 3 };
export const WebviewView = jest.fn();
export const WebviewPanel = jest.fn();
export const CancellationToken = {};
export const ProgressLocation = { Notification: 1 };
export class MarkdownString { value = ''; }
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export class Range { constructor(public start: any, public end: any) {} }
export class Position { constructor(public line: number, public character: number) {} }
export const TextDocument = jest.fn();
export const TextEditor = jest.fn();
export const workspaceState = { get: jest.fn(), update: jest.fn() };
export const globalState = { get: jest.fn(), update: jest.fn() };

export default {
    window,
    workspace,
    commands,
    Uri,
    ThemeIcon,
    ThemeColor,
    StatusBarAlignment,
    TreeItemCollapsibleState,
    EventEmitter,
    ConfigurationTarget,
    ExtensionContext,
    ViewColumn,
    WebviewView,
    WebviewPanel,
    CancellationToken,
    ProgressLocation,
    MarkdownString,
    DiagnosticSeverity,
    Range,
    Position,
    TextDocument,
    TextEditor,
    workspaceState,
    globalState
};