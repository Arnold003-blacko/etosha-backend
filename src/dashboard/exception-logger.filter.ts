import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from './logger.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly loggerService: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as any).requestId || 'unknown';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any).message || 'Unknown error';

    // Log the exception with full context
    this.loggerService.error(
      `Unhandled exception: ${request.method} ${request.url} - ${status}`,
      exception instanceof Error ? exception : new Error(String(exception)),
      request.url.includes('/auth/') || request.url.includes('/login') || request.url.includes('/signup')
        ? require('./logger.service').LogCategory.AUTH
        : require('./logger.service').LogCategory.SYSTEM,
      {
        requestId,
        method: request.method,
        url: request.url,
        statusCode: status,
        userId: (request as any).user?.id || (request as any).user?.sub || null,
        userEmail: (request as any).user?.email || null,
        ip: request.ip || request.connection?.remoteAddress,
        headers: {
          origin: request.headers.origin,
          userAgent: request.headers['user-agent'],
          contentType: request.headers['content-type'],
        },
        body: request.body,
        query: request.query,
        params: request.params,
        errorMessage: message,
        errorResponse: exceptionResponse,
        stack: exception instanceof Error ? exception.stack : undefined,
      },
    );

    // Send response
    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
      ...(typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? exceptionResponse
        : {}),
    });
  }
}
