import { ConfigManager } from '../src/config/manager';

describe('ConfigManager', () => {
  let mockContext: any;
  let mockConfig: any;
  let mockVscode: any;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn((key: string, defaultValue: any) => defaultValue),
      update: jest.fn().mockResolvedValue(undefined)
    };

    mockContext = {
      workspaceState: {},
      globalState: {}
    };

    mockVscode = require('vscode');
    jest.spyOn(mockVscode.workspace, 'getConfiguration').mockReturnValue(mockConfig);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return default values when config not set', () => {
    const configManager = new ConfigManager(mockContext);
    
    expect(configManager.get('enabled', true)).toBe(true);
    expect(configManager.get('acpCommand', 'hermes')).toBe('hermes');
    expect(configManager.get('acpArgs', ['acp'])).toEqual(['acp']);
    expect(configManager.get('autoApprovePermissions', false)).toBe(false);
    expect(configManager.get('showTokenUsage', true)).toBe(true);
  });

  it('should update config values', async () => {
    const configManager = new ConfigManager(mockContext);
    
    await configManager.update('autoApprovePermissions', true);
    
    expect(mockConfig.update).toHaveBeenCalledWith('autoApprovePermissions', true, expect.any(Number));
  });

  it('should reload config', () => {
    const configManager = new ConfigManager(mockContext);
    
    // getConfiguration is called in constructor + reload
    const initialCalls = mockVscode.workspace.getConfiguration.mock.calls.length;
    configManager.reload();
    const afterCalls = mockVscode.workspace.getConfiguration.mock.calls.length;
    
    expect(afterCalls - initialCalls).toBe(1);
  });
});