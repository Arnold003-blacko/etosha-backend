import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggerService, LogCategory } from './logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly enableLogging = process.env.ENABLE_HTTP_LOGGING !== 'false'; // Default: true
  private readonly logRequestBody = process.env.LOG_REQUEST_BODY === 'true'; // Default: false (security)
  private readonly slowRequestThreshold = parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS || '1000', 10); // 1 second

  constructor(private readonly loggerService: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Skip logging entirely if disabled
    if (!this.enableLogging) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const { method, url, headers, body, query, params, user } = request;
    const startTime = Date.now();

    // Generate request ID for tracking
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    request['requestId'] = requestId; // Attach to request for use in other parts of app

    // Sanitize sensitive data from request body
    const sanitizedBody = this.sanitizeRequestBody(body);

    // Log request start
    this.loggerService.logHttp(
      method,
      url,
      0, // Will be updated when response completes
      0,
      {
        requestId,
        origin: headers.origin,
        userAgent: headers['user-agent'],
        ip: request.ip || request.connection?.remoteAddress,
        userId: user?.id || user?.sub || null,
        userEmail: user?.email || null,
        queryParams: Object.keys(query).length > 0 ? query : undefined,
        routeParams: Object.keys(params).length > 0 ? params : undefined,
        requestBody: this.logRequestBody ? sanitizedBody : undefined,
        contentType: headers['content-type'],
      },
    );

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode || 200;

          // Log slow requests as warnings
          if (duration > this.slowRequestThreshold) {
            this.loggerService.warn(
              `Slow request detected: ${method} ${url} took ${duration}ms`,
              LogCategory.HTTP,
              {
                requestId,
                duration,
                threshold: this.slowRequestThreshold,
                url,
                method,
              },
            );
          }

          // Log successful response
          this.loggerService.logHttp(
            method,
            url,
            statusCode,
            duration,
            {
              requestId,
              origin: headers.origin,
              userAgent: headers['user-agent'],
              ip: request.ip || request.connection?.remoteAddress,
              userId: user?.id || user?.sub || null,
              userEmail: user?.email || null,
              responseSize: JSON.stringify(data).length,
              isSlow: duration > this.slowRequestThreshold,
            },
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;

          // Enhanced error logging with full context
          this.loggerService.error(
            `Request failed: ${method} ${url} - ${statusCode} (${duration}ms)`,
            error,
            url.includes('/auth/') || url.includes('/login') || url.includes('/signup')
              ? LogCategory.AUTH
              : LogCategory.HTTP,
            {
              requestId,
              method,
              url,
              statusCode,
              duration,
              userId: user?.id || user?.sub || null,
              userEmail: user?.email || null,
              ip: request.ip || request.connection?.remoteAddress,
              queryParams: query,
              routeParams: params,
              requestBody: this.logRequestBody ? sanitizedBody : undefined,
              errorName: error.name,
              errorMessage: error.message,
              errorStack: error.stack,
              // Include validation errors if present
              validationErrors: error.response?.message || error.message,
            },
          );

          // Also log as HTTP with error status
          this.loggerService.logHttp(
            method,
            url,
            statusCode,
            duration,
            {
              requestId,
              origin: headers.origin,
              userAgent: headers['user-agent'],
              ip: request.ip || request.connection?.remoteAddress,
              userId: user?.id || user?.sub || null,
              error: error.message,
              errorName: error.name,
              isError: true,
            },
          );
        },
      }),
    );
  }

  /**
   * Sanitize sensitive data from request body
   */
  private sanitizeRequestBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'authorization', 'creditCard', 'cvv', 'ssn'];
    const sanitized = { ...body };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    }

    return sanitized;
  }
}
