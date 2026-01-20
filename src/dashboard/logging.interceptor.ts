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
  constructor(private readonly loggerService: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const { method, url, headers } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode || 200;

          // Update the last log entry with status code and duration
          this.loggerService.logHttp(
            method,
            url,
            statusCode,
            duration,
            {
              origin: headers.origin,
              userAgent: headers['user-agent'],
              ip: request.ip || request.connection?.remoteAddress,
            },
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;

          this.loggerService.error(
            `${method} ${url} - ${statusCode}`,
            error,
            url.includes('/auth/') || url.includes('/login') || url.includes('/signup')
              ? LogCategory.AUTH
              : LogCategory.HTTP,
          );

          // Also log as HTTP with error status
          this.loggerService.logHttp(
            method,
            url,
            statusCode,
            duration,
            {
              origin: headers.origin,
              userAgent: headers['user-agent'],
              ip: request.ip || request.connection?.remoteAddress,
              error: error.message,
            },
          );
        },
      }),
    );
  }
}
