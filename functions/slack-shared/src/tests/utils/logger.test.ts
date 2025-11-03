import { logger, LogLevel } from '../../utils/logger';

describe('logger', () => {
  const originalEnv = process.env.LOG_LEVEL;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  beforeEach(() => {
    // Reset logger config
    logger.reset();
    delete process.env.LOG_LEVEL;
    
    // Mock console methods
    console.error = jest.fn();
    console.warn = jest.fn();
    console.log = jest.fn();
  });

  afterEach(() => {
    process.env.LOG_LEVEL = originalEnv;
    console.error = originalError;
    console.warn = originalWarn;
    console.log = originalLog;
  });

  describe('error', () => {
    it('should always log error messages', () => {
      logger.error('Test error');
      expect(console.error).toHaveBeenCalled();
    });

    it('should log error with error object', () => {
      const error = new Error('Test error');
      logger.error('Error occurred', error);
      expect(console.error).toHaveBeenCalled();
    });

    it('should log error even when LOG_LEVEL is ERROR', () => {
      process.env.LOG_LEVEL = 'ERROR';
      logger.reset();
      
      logger.error('Test error');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('should log warn messages when LOG_LEVEL >= WARN', () => {
      process.env.LOG_LEVEL = 'WARN';
      logger.reset();
      
      logger.warn('Test warning');
      expect(console.warn).toHaveBeenCalled();
    });

    it('should not log warn when LOG_LEVEL is ERROR', () => {
      process.env.LOG_LEVEL = 'ERROR';
      logger.reset();
      
      logger.warn('Test warning');
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should log warn with error object', () => {
      process.env.LOG_LEVEL = 'WARN';
      logger.reset();
      
      const error = new Error('Test error');
      logger.warn('Warning occurred', error);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('info', () => {
    it('should log info messages when LOG_LEVEL >= INFO', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger.reset();
      
      logger.info('Test info');
      expect(console.log).toHaveBeenCalled();
    });

    it('should not log info when LOG_LEVEL is ERROR', () => {
      process.env.LOG_LEVEL = 'ERROR';
      logger.reset();
      
      logger.info('Test info');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should not log info when LOG_LEVEL is WARN', () => {
      process.env.LOG_LEVEL = 'WARN';
      logger.reset();
      
      logger.info('Test info');
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('debug', () => {
    it('should log debug messages when LOG_LEVEL is DEBUG', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      logger.reset();
      
      logger.debug('Test debug');
      expect(console.log).toHaveBeenCalled();
    });

    it('should not log debug when LOG_LEVEL is INFO', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger.reset();
      
      logger.debug('Test debug');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should not log debug when LOG_LEVEL is ERROR', () => {
      process.env.LOG_LEVEL = 'ERROR';
      logger.reset();
      
      logger.debug('Test debug');
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('getLevel', () => {
    it('should return ERROR level by default', () => {
      expect(logger.getLevel()).toBe(LogLevel.ERROR);
    });

    it('should return WARN level when set', () => {
      process.env.LOG_LEVEL = 'WARN';
      logger.reset();
      expect(logger.getLevel()).toBe(LogLevel.WARN);
    });

    it('should return INFO level when set', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger.reset();
      expect(logger.getLevel()).toBe(LogLevel.INFO);
    });

    it('should return DEBUG level when set', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      logger.reset();
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('should default to ERROR for invalid LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'INVALID';
      logger.reset();
      expect(logger.getLevel()).toBe(LogLevel.ERROR);
      expect(console.warn).toHaveBeenCalled();
    });

    it('should be case insensitive', () => {
      process.env.LOG_LEVEL = 'info';
      logger.reset();
      expect(logger.getLevel()).toBe(LogLevel.INFO);
    });
  });
});

