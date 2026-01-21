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
    // Request tracking
    requestId?: string;
    method?: string;
    url?: string;
    statusCode?: number;
    duration?: number;
    isSlow?: boolean;
    isError?: boolean;
    
    // User context
    userId?: string;
    userEmail?: string;
    
    // Network info
    origin?: string;
    userAgent?: string;
    ip?: string;
    
    // Request details
    queryParams?: any;
    routeParams?: any;
    requestBody?: any;
    responseSize?: number;
    contentType?: string;
    
    // Error details
    error?: string;
    errorName?: string;
    errorMessage?: string;
    errorStack?: string;
    validationErrors?: any;
    
    // Database/performance
    dbQuery?: string;
    dbDuration?: number;
    
    // Business events
    eventType?: string;
    eventData?: any;
    
    // Thresholds and warnings
    threshold?: number;
    
    [key: string]: any;
  };
}

@Injectable()
export class LoggerService {
  private logs: LogEntry[] = [];
  // Configurable max logs - defaults to 1000 (reduced from 10k for better performance)
  private maxLogs = parseInt(process.env.LOG_MAX_ENTRIES || '1000', 10);
  private startTime = Date.now();
  
  // Logging configuration from environment variables
  private readonly enableHttpLogging = process.env.ENABLE_HTTP_LOGGING !== 'false'; // Default: true
  private readonly logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase(); // 'debug' | 'info' | 'warn' | 'error'
  private readonly logSampleRate = parseFloat(process.env.LOG_SAMPLE_RATE || '1.0'); // 0.0 to 1.0 (1.0 = log all, 0.1 = log 10%)
  
  // Skip logging for these paths (health checks, static assets, etc.)
  private readonly skipPaths = [
    '/health',
    '/',
    '/dashboard/health',
    '/favicon.ico',
  ];

  /**
   * Check if a log level should be logged based on configuration
   */
  private shouldLog(level: LogLevel): boolean {
    const levelPriority: Record<LogLevel, number> = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.HTTP]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3,
    };

    const configPriority: Record<string, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    const minPriority = configPriority[this.logLevel] ?? 1;
    return levelPriority[level] >= minPriority;
  }

  /**
   * Check if URL should be logged (skip health checks, etc.)
   */
  private shouldLogUrl(url: string): boolean {
    return !this.skipPaths.some(path => url === path || url.startsWith(path + '/'));
  }

  /**
   * Check if request should be sampled (for performance)
   */
  private shouldSample(): boolean {
    if (this.logSampleRate >= 1.0) return true;
    return Math.random() < this.logSampleRate;
  }

  /**
   * Add a log entry
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    metadata?: LogEntry['metadata'],
  ) {
    // Skip if log level is below configured minimum
    if (!this.shouldLog(level)) {
      return;
    }

    // Skip HTTP logs if disabled
    if (level === LogLevel.HTTP && !this.enableHttpLogging) {
      return;
    }

    // Skip if URL is in skip list
    if (metadata?.url && !this.shouldLogUrl(metadata.url)) {
      return;
    }
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
    // Skip if HTTP logging is disabled
    if (!this.enableHttpLogging) {
      return;
    }

    // Skip health checks and other non-essential paths
    if (!this.shouldLogUrl(url)) {
      return;
    }

    // Apply sampling for non-error requests (reduce load)
    if (statusCode < 400 && !this.shouldSample()) {
      return;
    }

    // Always log errors (status >= 400)
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
    
    // Get total system memory if available (Node.js 18+)
    let totalMemory: number | null = null;
    let freeMemory: number | null = null;
    try {
      // @ts-ignore - os.totalmem() and os.freemem() are available
      const os = require('os');
      totalMemory = Math.round(os.totalmem() / 1024 / 1024); // MB
      freeMemory = Math.round(os.freemem() / 1024 / 1024); // MB
    } catch (e) {
      // Fallback if os module not available
    }

    // Calculate memory percentages
    const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);
    const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const externalMB = Math.round(memoryUsage.external / 1024 / 1024);
    
    // Calculate heap usage percentage
    const heapUsagePercent = heapTotalMB > 0 
      ? Math.round((heapUsedMB / heapTotalMB) * 100) 
      : 0;

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
        // RSS (Resident Set Size) - Actual memory used by the process
        rss: rssMB,
        // Heap memory (JavaScript objects)
        heapTotal: heapTotalMB,
        heapUsed: heapUsedMB,
        heapUsagePercent: heapUsagePercent,
        // External memory (C++ objects, buffers)
        external: externalMB,
        // System memory (if available)
        systemTotal: totalMemory,
        systemFree: freeMemory,
        systemUsed: totalMemory && freeMemory ? totalMemory - freeMemory : null,
        systemUsagePercent: totalMemory && freeMemory 
          ? Math.round(((totalMemory - freeMemory) / totalMemory) * 100) 
          : null,
        // Array buffer memory
        arrayBuffers: memoryUsage.arrayBuffers 
          ? Math.round(memoryUsage.arrayBuffers / 1024 / 1024) 
          : 0,
      },
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      // Environment info
      env: {
        nodeEnv: process.env.NODE_ENV || 'development',
        // Check if running in Railway (they set RAILWAY_ENVIRONMENT)
        isRailway: !!process.env.RAILWAY_ENVIRONMENT,
        // Railway memory limit if set
        railwayMemoryLimit: process.env.RAILWAY_MEMORY_LIMIT_MB 
          ? parseInt(process.env.RAILWAY_MEMORY_LIMIT_MB, 10) 
          : null,
      },
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
