/**
 * Log levels in order of severity (highest to lowest)
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * Logger configuration
 */
interface LoggerConfig {
  level: LogLevel;
}

/**
 * Get log level from environment variable
 * Defaults to ERROR for production (only critical errors)
 * Valid values: ERROR, WARN, INFO, DEBUG
 */
function getLogLevelFromEnv(): LogLevel {
  const logLevelEnv = (process.env.LOG_LEVEL || 'ERROR').toUpperCase();
  
  switch (logLevelEnv) {
    case 'ERROR':
      return LogLevel.ERROR;
    case 'WARN':
      return LogLevel.WARN;
    case 'INFO':
      return LogLevel.INFO;
    case 'DEBUG':
      return LogLevel.DEBUG;
    default:
      // Default to ERROR if invalid value
      console.warn(`Invalid LOG_LEVEL "${logLevelEnv}", defaulting to ERROR`);
      return LogLevel.ERROR;
  }
}

/**
 * Logger instance configuration
 * Initialized once per Lambda execution
 */
let loggerConfig: LoggerConfig | null = null;

/**
 * Initialize logger configuration (call once per Lambda invocation)
 */
function initLogger(): LoggerConfig {
  if (!loggerConfig) {
    loggerConfig = {
      level: getLogLevelFromEnv(),
    };
  }
  return loggerConfig;
}

/**
 * Format log message with optional error
 */
function formatLogMessage(level: string, message: string, error?: unknown): string {
  const timestamp = new Date().toISOString();
  const baseMessage = `[${timestamp}] [${level}] ${message}`;
  
  if (error !== undefined) {
    const errorStr = error instanceof Error 
      ? `${error.message}${error.stack ? `\n${error.stack}` : ''}`
      : String(error);
    return `${baseMessage}\n${errorStr}`;
  }
  
  return baseMessage;
}

/**
 * Centralized logger with configurable log levels
 * 
 * Usage:
 * - logger.error('Critical error', error) - Always logged
 * - logger.warn('Warning message') - Logged if level >= WARN
 * - logger.info('Info message') - Logged if level >= INFO
 * - logger.debug('Debug message') - Logged if level >= DEBUG
 * 
 * Log level is controlled by LOG_LEVEL environment variable:
 * - ERROR (default): Only errors
 * - WARN: Errors and warnings
 * - INFO: Errors, warnings, and info
 * - DEBUG: All messages
 */
class Logger {
  private config: LoggerConfig;

  constructor() {
    this.config = initLogger();
  }

  /**
   * Log error message (always logged)
   */
  error(message: string, error?: unknown): void {
    console.error(formatLogMessage('ERROR', message, error));
  }

  /**
   * Log warning message (logged if level >= WARN)
   */
  warn(message: string, error?: unknown): void {
    if (this.config.level >= LogLevel.WARN) {
      console.warn(formatLogMessage('WARN', message, error));
    }
  }

  /**
   * Log info message (logged if level >= INFO)
   */
  info(message: string): void {
    if (this.config.level >= LogLevel.INFO) {
      console.log(formatLogMessage('INFO', message));
    }
  }

  /**
   * Log debug message (logged if level >= DEBUG)
   */
  debug(message: string): void {
    if (this.config.level >= LogLevel.DEBUG) {
      console.log(formatLogMessage('DEBUG', message));
    }
  }

  /**
   * Get current log level (for testing/debugging)
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * Reset logger config (for testing)
   */
  reset(): void {
    loggerConfig = null;
  }
}

/**
 * Singleton logger instance
 * Shared across all modules in a Lambda execution
 */
export const logger = new Logger();
