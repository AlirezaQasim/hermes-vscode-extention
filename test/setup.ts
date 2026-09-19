import * as vscode from 'vscode';

// Mock vscode for testing
jest.mock('vscode', () => ({
  ...jest.requireActual('vscode'),
  window: {
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
  },
  workspace: {
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
  },
  commands: {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
    executeCommand: jest.fn(),
    getCommands: jest.fn()
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
    joinPath: jest.fn((base: any, ...paths: string[]) => ({ fsPath: paths.join('/') }))
  },
  ThemeIcon: jest.fn(),
  ThemeColor: jest.fn(),
  StatusBarAlignment: { Left: 1, Right: 2 },
  TreeItemCollapsibleState: { None: 0, Expanded: 1, Collapsed: 2 },
  EventEmitter: class EventEmitter<T> {
    private listeners: ((data: T) => void)[] = [];
    event = (listener: (data: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire(data?: T) { this.listeners.forEach(l => l(data!)); }
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ExtensionContext: jest.fn(),
  ViewColumn: { One: 1, Two: 2, Three: 3 },
  WebviewView: jest.fn(),
  WebviewPanel: jest.fn(),
  CancellationToken: {},
  ProgressLocation: { Notification: 1 },
  MarkdownString: class MarkdownString { value = ''; },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Range: class Range { constructor(public start: any, public end: any) {} },
  Position: class Position { constructor(public line: number, public character: number) {} },
  TextDocument: jest.fn(),
  TextEditor: jest.fn(),
  workspaceState: { get: jest.fn(), update: jest.fn() },
  globalState: { get: jest.fn(), update: jest.fn() }
}));

// Global test timeout
jest.setTimeout(10000);

// Silence console.error in tests unless explicitly testing errors
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (args[0]?.includes?.('Warning:') || args[0]?.includes?.('act(')) return;
    originalError.apply(console, args);
  };
});

afterAll(() => {
  console.error = originalError;
});