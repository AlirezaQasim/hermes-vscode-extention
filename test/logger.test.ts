import { Logger } from '../src/utils/logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger('Test');
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should log at info level by default', () => {
    logger.info('Test message');
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] [Test] Test message'));
  });

  it('should not log debug at info level', () => {
    logger.setLevel('info');
    logger.debug('Debug message');
    expect(consoleDebugSpy).not.toHaveBeenCalled();
  });

  it('should log debug at debug level', () => {
    logger.setLevel('debug');
    logger.debug('Debug message');
    expect(consoleDebugSpy).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] [Test] Debug message'));
  });

  it('should log warn at warn level and above', () => {
    logger.setLevel('warn');
    logger.warn('Warning');
    logger.error('Error');
    
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN]'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
  });

  it('should log error at error level', () => {
    logger.setLevel('error');
    logger.error('Error');
    
    // At error level, only error is logged (not warn)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should format error objects', () => {
    const error = new Error('Test error');
    error.stack = 'stack trace';
    
    logger.error('Error occurred', error);
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: Test error'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('stack trace'));
  });

  it('should format objects as JSON', () => {
    const obj = { key: 'value', nested: { num: 42 } };
    logger.info('Object:', obj);
    
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('"key": "value"'));
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('"num": 42'));
  });

  it('should include timestamp in logs', () => {
    logger.info('Test');
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/));
  });
});