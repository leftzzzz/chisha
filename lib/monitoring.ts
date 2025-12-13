/**
 * 监控系统
 *
 * 用于错误追踪、性能监控和用户行为分析
 */

/**
 * 错误严重级别
 */
export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * 错误信息
 */
export interface ErrorInfo {
  message: string;
  stack?: string;
  severity: ErrorSeverity;
  context?: Record<string, unknown>;
  timestamp: number;
  userAgent?: string;
  url?: string;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 用户操作
 */
export interface UserAction {
  action: string;
  category: string;
  label?: string;
  value?: number;
  timestamp: number;
}

/**
 * 监控配置
 */
interface MonitoringConfig {
  enableErrorTracking: boolean;
  enablePerformanceTracking: boolean;
  enableUserTracking: boolean;
  sampleRate: number; // 0-1，采样率
  endpoint?: string; // 上报端点
}

class MonitoringService {
  private config: MonitoringConfig;
  private errorQueue: ErrorInfo[] = [];
  private performanceQueue: PerformanceMetrics[] = [];
  private actionQueue: UserAction[] = [];
  private flushInterval: number = 10000; // 10秒
  private flushTimer?: NodeJS.Timeout;

  constructor(config: Partial<MonitoringConfig> = {}) {
    this.config = {
      enableErrorTracking: true,
      enablePerformanceTracking: true,
      enableUserTracking: true,
      sampleRate: 1.0,
      ...config,
    };

    this.init();
  }

  /**
   * 初始化
   */
  private init() {
    if (typeof window === 'undefined') {
      return;
    }

    // 捕获全局错误
    if (this.config.enableErrorTracking) {
      window.addEventListener('error', (event) => {
        this.captureError({
          message: event.message,
          stack: event.error?.stack,
          severity: ErrorSeverity.ERROR,
          context: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          },
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.captureError({
          message: `Unhandled Promise Rejection: ${event.reason}`,
          severity: ErrorSeverity.ERROR,
          context: {
            promise: String(event.promise),
            reason: String(event.reason),
          },
        });
      });
    }

    // 启动自动上报
    this.startFlushTimer();

    // 页面卸载时上报
    window.addEventListener('beforeunload', () => {
      this.flush();
    });
  }

  /**
   * 捕获错误
   */
  captureError(error: Omit<ErrorInfo, 'timestamp' | 'userAgent' | 'url'>) {
    if (!this.config.enableErrorTracking) {
      return;
    }

    if (!this.shouldSample()) {
      return;
    }

    const errorInfo: ErrorInfo = {
      ...error,
      timestamp: Date.now(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    };

    this.errorQueue.push(errorInfo);

    // 记录到控制台
    console.error('[Monitoring]', errorInfo);

    // 如果是严重错误，立即上报
    if (error.severity === ErrorSeverity.CRITICAL) {
      this.flush();
    }
  }

  /**
   * 记录性能指标
   */
  capturePerformance(metrics: Omit<PerformanceMetrics, 'timestamp'>) {
    if (!this.config.enablePerformanceTracking) {
      return;
    }

    if (!this.shouldSample()) {
      return;
    }

    const performanceInfo: PerformanceMetrics = {
      ...metrics,
      timestamp: Date.now(),
    };

    this.performanceQueue.push(performanceInfo);

    // 记录到控制台(开发环境)
    if (process.env.NODE_ENV === 'development') {
      console.log('[Performance]', performanceInfo);
    }
  }

  /**
   * 记录用户操作
   */
  captureUserAction(action: Omit<UserAction, 'timestamp'>) {
    if (!this.config.enableUserTracking) {
      return;
    }

    if (!this.shouldSample()) {
      return;
    }

    const actionInfo: UserAction = {
      ...action,
      timestamp: Date.now(),
    };

    this.actionQueue.push(actionInfo);

    // 记录到控制台(开发环境)
    if (process.env.NODE_ENV === 'development') {
      console.log('[User Action]', actionInfo);
    }
  }

  /**
   * 测量性能
   */
  async measure<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.capturePerformance({ name, duration, metadata });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.captureError({
        message: `Performance measurement failed: ${name}`,
        severity: ErrorSeverity.ERROR,
        context: { duration, metadata, error: String(error) },
      });
      throw error;
    }
  }

  /**
   * 采样判断
   */
  private shouldSample(): boolean {
    return Math.random() < this.config.sampleRate;
  }

  /**
   * 启动定时上报
   */
  private startFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * 上报数据
   */
  private flush() {
    if (!this.config.endpoint) {
      // 没有配置端点，只清空队列
      this.errorQueue = [];
      this.performanceQueue = [];
      this.actionQueue = [];
      return;
    }

    const payload = {
      errors: this.errorQueue,
      performance: this.performanceQueue,
      actions: this.actionQueue,
    };

    // 如果有数据，发送到端点
    if (this.errorQueue.length > 0 || this.performanceQueue.length > 0 || this.actionQueue.length > 0) {
      // 使用 sendBeacon (更可靠) 或 fetch
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(this.config.endpoint, JSON.stringify(payload));
      } else {
        fetch(this.config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch((error) => {
          console.error('Failed to send monitoring data:', error);
        });
      }

      // 清空队列
      this.errorQueue = [];
      this.performanceQueue = [];
      this.actionQueue = [];
    }
  }

  /**
   * 销毁
   */
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }
}

// 创建单例
const monitoring = new MonitoringService({
  enableErrorTracking: true,
  enablePerformanceTracking: true,
  enableUserTracking: true,
  sampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0, // 生产环境采样10%
  // endpoint: '/api/monitoring', // 可选：配置上报端点
});

/**
 * 便利函数：捕获错误
 */
export function captureError(message: string, severity: ErrorSeverity = ErrorSeverity.ERROR, context?: Record<string, unknown>) {
  monitoring.captureError({ message, severity, context });
}

/**
 * 便利函数：记录性能
 */
export function capturePerformance(name: string, duration: number, metadata?: Record<string, unknown>) {
  monitoring.capturePerformance({ name, duration, metadata });
}

/**
 * 便利函数：记录用户操作
 */
export function captureUserAction(action: string, category: string, label?: string, value?: number) {
  monitoring.captureUserAction({ action, category, label, value });
}

/**
 * 便利函数：测量性能
 */
export async function measurePerformance<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
  return monitoring.measure(name, fn, metadata);
}

export default monitoring;
