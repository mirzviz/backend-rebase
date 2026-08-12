import { createLogger as createLogzioClient } from 'logzio-nodejs/lib/logzio-nodejs';
import { LogzioConfig } from './config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogFields = Record<string, unknown>;

export interface LogShipper {
  log(entry: Record<string, unknown>): void;
}

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
}

interface Sink {
  log(line: string): void;
}

// Console output is unconditional: whoever runs this server needs to see
// what it's doing without needing a Logz.io account. Shipping is additive
// on top of that, and is never allowed to affect the caller - a network
// hiccup shipping a log line must not become a broken request, so the
// shipper call is wrapped and never awaited.
export function createLogger(shipper: LogShipper | null, sink: Sink = console): Logger {
  return {
    log(level, message, fields = {}) {
      const entry = { timestamp: new Date().toISOString(), level, message, ...fields };
      sink.log(JSON.stringify(entry));

      if (!shipper) return;
      try {
        shipper.log(entry);
      } catch (err) {
        sink.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            message: 'failed to ship log entry',
            error: String(err),
          }),
        );
      }
    },
  };
}

export function logzioOptionsFrom(config: LogzioConfig) {
  return {
    token: config.token,
    host: config.host,
    type: config.type,
    protocol: config.protocol,
    // logzio-nodejs's own type declares port as a string; our Config keeps
    // it numeric since it's just another network port everywhere else.
    port: String(config.port),
  };
}

export function createLogzioShipper(config: LogzioConfig): LogShipper {
  const client = createLogzioClient({
    ...logzioOptionsFrom(config),
    callback: (err) => {
      if (err) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            message: 'failed to ship a batch of logs to Logz.io',
            error: String(err),
          }),
        );
      }
    },
  });

  return {
    log: (entry) => client.log(entry),
  };
}
