/**
 * 日志工具
 * 支持不同日志级别，输出 JSON 格式
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

class Logger {
  private minLevel: LogLevel;

  constructor() {
    const levelFromEnv = process.env.LOG_LEVEL?.toLowerCase();
    this.minLevel = this.isValidLevel(levelFromEnv) ? levelFromEnv : 'info';
  }

  private isValidLevel(level: string | undefined): level is LogLevel {
    return level === 'debug' || level === 'info' || level === 'warn' || level === 'error';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const minIndex = levels.indexOf(this.minLevel);
    const currentIndex = levels.indexOf(level);
    return currentIndex >= minIndex;
  }

  private formatLog(level: LogLevel, message: string, data?: unknown): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(data !== undefined && { data }),
    };
  }

  private output(entry: LogEntry): void {
    const json = JSON.stringify(entry);

    // 根据日志级别输出到不同流
    if (entry.level === 'error') {
      console.error(json);
    } else if (entry.level === 'warn') {
      console.warn(json);
    } else {
      console.log(json);
    }
  }

  /**
   * Debug 级别日志
   */
  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      this.output(this.formatLog('debug', message, data));
    }
  }

  /**
   * Info 级别日志
   */
  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      this.output(this.formatLog('info', message, data));
    }
  }

  /**
   * Warning 级别日志
   */
  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      this.output(this.formatLog('warn', message, data));
    }
  }

  /**
   * Error 级别日志
   */
  error(message: string, data?: unknown): void {
    if (this.shouldLog('error')) {
      this.output(this.formatLog('error', message, data));
    }
  }
}

// 导出单例
export const logger = new Logger();
