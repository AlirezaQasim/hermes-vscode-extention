import { Logger } from '../src/utils/logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger('Test');
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should log at info level by default', () => {
    logger.info('Test message');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] [Test] Test message'));
  });

  it('should not log debug at info level', () => {
    logger.setLevel('info');
    logger.debug('Debug message');
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'));
  });

  it('should log debug at debug level', () => {
    logger.setLevel('debug');
    logger.debug('Debug message');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] [Test] Debug message'));
  });

  it('should log warn and error at all levels', () => {
    logger.setLevel('error');
    logger.warn('Warning');
    logger.error('Error');
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN]'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
  });

  it('should format error objects', () => {
    const error = new Error('Test error');
    error.stack = 'stack trace';
    
    logger.error('Error occurred', error);
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error: Test error'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('stack trace'));
  });

  it('should format objects as JSON', () => {
    const obj = { key: 'value', nested: { num: 42 } };
    logger.info('Object:', obj);
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"key": "value"'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"num": 42'));
  });

  it('should include timestamp in logs', () => {
    logger.info('Test');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/));
  });
});