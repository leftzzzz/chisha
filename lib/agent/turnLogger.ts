/**
 * 带会话上下文的日志器。
 *
 * 此前 Agent 链路的日志既不带 sessionId 也不带 turnId，服务端日志无法与
 * trace join，出问题只能靠时间戳猜。这里统一注入这两个字段。
 */

import { logger } from '@/lib/logger';

export interface TurnLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createTurnLogger(sessionId?: string, turnId?: string): TurnLogger {
  const context = {
    sessionId: sessionId ?? 'transient',
    ...(turnId ? { turnId } : {}),
  };

  return {
    info: (message, data) => logger.info(message, { ...context, ...data }),
    warn: (message, data) => logger.warn(message, { ...context, ...data }),
    error: (message, data) => logger.error(message, { ...context, ...data }),
  };
}
