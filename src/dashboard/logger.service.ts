import { Injectable } from '@nestjs/common';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  HTTP = 'http',
}

export enum LogCategory {
  SYSTEM = 'system',
  HTTP = 'http',
  DATABASE = 'database',
  AUTH = 'auth',
  PAYMENT = 'payment',
  WEBSOCKET = 'websocket',
  UNKNOWN = 'unknown',
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  timestamp: Date;
  metadata?: {
    method?: string;
    url?: string;
    statusCode?: number;
    duration?: number;
    origin?: string;
    userAgent?: string;
    userId?: string;
    error?: string;
    stack?: string;
    [key: string]: any;
  };
}

@Injectable()
export class LoggerService {
  private logs: LogEntry[] = [];
  private maxLogs = 10000; // Keep last 10k logs
  private startTime = Date.now();

  /**
   * Add a log entry
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    metadata?: LogEntry['metadata'],
  ) {
    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      level,
      category,
      message,
      timestamp: new Date(),
      metadata,
    };

    this.logs.push(logEntry);

    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Also log to console with appropriate level
    const consoleMessage = `[${logEntry.category.toUpperCase()}] ${logEntry.message}`;
    const consoleMetadata = metadata ? ` ${JSON.stringify(metadata)}` : '';

    switch (level) {
      case LogLevel.ERROR:
        console.error(consoleMessage + consoleMetadata);
        break;
      case LogLevel.WARN:
        console.warn(consoleMessage + consoleMetadata);
        break;
      case LogLevel.DEBUG:
        console.debug(consoleMessage + consoleMetadata);
        break;
      default:
        console.log(consoleMessage + consoleMetadata);
    }
  }

  /**
   * Log HTTP request
   */
  logHttp(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    metadata?: Partial<LogEntry['metadata']>,
  ) {
    // Determine category based on URL
    let category = LogCategory.HTTP;
    if (url.includes('/auth/') || url.includes('/login') || url.includes('/signup')) {
      category = LogCategory.AUTH;
    } else if (url.includes('/payment') || url.includes('/paynow')) {
      category = LogCategory.PAYMENT;
    } else if (url.includes('/dashboard')) {
      category = LogCategory.SYSTEM;
    }

    // Determine level based on status code
    let level = LogLevel.HTTP;
    if (statusCode >= 500) {
      level = LogLevel.ERROR;
    } else if (statusCode >= 400) {
      level = LogLevel.WARN;
    }

    this.log(level, category, `${method} ${url} - ${statusCode}`, {
      method,
      url,
      statusCode,
      duration,
      ...metadata,
    });
  }

  /**
   * Log error
   */
  error(message: string, error?: Error, category: LogCategory = LogCategory.SYSTEM) {
    this.log(LogLevel.ERROR, category, message, {
      error: error?.message,
      stack: error?.stack,
    });
  }

  /**
   * Log info
   */
  info(message: string, category: LogCategory = LogCategory.SYSTEM, metadata?: LogEntry['metadata']) {
    this.log(LogLevel.INFO, category, message, metadata);
  }

  /**
   * Log warning
   */
  warn(message: string, category: LogCategory = LogCategory.SYSTEM, metadata?: LogEntry['metadata']) {
    this.log(LogLevel.WARN, category, message, metadata);
  }

  /**
   * Log debug
   */
  debug(message: string, category: LogCategory = LogCategory.SYSTEM, metadata?: LogEntry['metadata']) {
    this.log(LogLevel.DEBUG, category, message, metadata);
  }

  /**
   * Get logs with filtering
   */
  getLogs(options?: {
    level?: LogLevel;
    category?: LogCategory;
    limit?: number;
    startTime?: Date;
    endTime?: Date;
    search?: string;
  }): LogEntry[] {
    let filtered = [...this.logs];

    if (options?.level) {
      filtered = filtered.filter((log) => log.level === options.level);
    }

    if (options?.category) {
      filtered = filtered.filter((log) => log.category === options.category);
    }

    if (options?.startTime) {
      filtered = filtered.filter(
        (log) => log.timestamp >= options.startTime!,
      );
    }

    if (options?.endTime) {
      filtered = filtered.filter((log) => log.timestamp <= options.endTime!);
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          log.message.toLowerCase().includes(searchLower) ||
          log.category.toLowerCase().includes(searchLower) ||
          log.metadata?.url?.toLowerCase().includes(searchLower),
      );
    }

    // Reverse to show newest first
    filtered.reverse();

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Get logs count
   */
  getLogCount(): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byCategory: Record<LogCategory, number>;
  } {
    const byLevel: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    // Initialize counters
    Object.values(LogLevel).forEach((level) => {
      byLevel[level] = 0;
    });
    Object.values(LogCategory).forEach((category) => {
      byCategory[category] = 0;
    });

    // Count logs
    this.logs.forEach((log) => {
      byLevel[log.level]++;
      byCategory[log.category]++;
    });

    return {
      total: this.logs.length,
      byLevel: byLevel as Record<LogLevel, number>,
      byCategory: byCategory as Record<LogCategory, number>,
    };
  }

  /**
   * Clear logs
   */
  clearLogs() {
    this.logs = [];
    this.info('Logs cleared', LogCategory.SYSTEM);
  }

  /**
   * Get server health info
   */
  getHealthInfo() {
    const uptime = Date.now() - this.startTime;
    const memoryUsage = process.memoryUsage();

    return {
      status: 'ok',
      uptime: {
        milliseconds: uptime,
        seconds: Math.floor(uptime / 1000),
        minutes: Math.floor(uptime / 60000),
        hours: Math.floor(uptime / 3600000),
        days: Math.floor(uptime / 86400000),
        formatted: this.formatUptime(uptime),
      },
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memoryUsage.external / 1024 / 1024), // MB
      },
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
    };
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
