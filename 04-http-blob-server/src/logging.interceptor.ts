import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { Logger, LogLevel, LOGGER } from './logging';

// One structured log line per HTTP request: method, path, final status, and
// how long it took. This is the "proper logging is a must" baseline; domain
// events (warm-up totals, quota rejections) are logged separately by
// BlobsService. Registered globally in AppModule via APP_INTERCEPTOR.
//
// It hooks the response's 'finish'/'close' events rather than the handler's
// return value: by the time those fire, res.statusCode is the real final
// code for every path - a 204 from @HttpCode, a 404 from an exception
// filter, or a 200 on a streamed GET - which isn't yet true when an
// interceptor's own tap() runs.
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();

    let logged = false;
    const finish = (message: 'request completed' | 'request aborted') => {
      if (logged) return;
      logged = true;

      const status = res.statusCode;
      const level: LogLevel =
        message === 'request aborted' || status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

      this.logger.log(level, message, {
        method: req.method,
        path: req.originalUrl ?? req.url,
        status,
        durationMs: Date.now() - startedAt,
      });
    };

    // 'finish' = response fully flushed (normal case, fires before 'close').
    // 'close' without a preceding 'finish' = the client hung up mid-response.
    res.on('finish', () => finish('request completed'));
    res.on('close', () => finish('request aborted'));

    return next.handle();
  }
}
