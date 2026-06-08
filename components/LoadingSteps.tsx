/**
 * LoadingSteps 组件
 *
 * Agent 搜索进度显示，支持动态多轮搜索和实时餐厅列表展示
 */

import React, { useState } from 'react';
import type { SearchProgress } from '@/hooks/useRestaurantSearch';
import { Button } from './ui';

export interface LoadingStepsProps {
  progress: SearchProgress;
  onQuestionReply?: (answer: string) => Promise<void> | void;
  isReplying?: boolean;
}

/**
 * 获取状态图标
 */
function StatusIcon({ status }: { status: SearchProgress['status'] }) {
  switch (status) {
    case 'done':
      return (
        <svg
          className="w-5 h-5 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      );
    case 'error':
      return (
        <svg
          className="w-5 h-5 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      );
    case 'question':
      return (
        <svg
          className="w-5 h-5 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.25 9a3.75 3.75 0 117.15 1.61c-.9.5-1.65 1.12-1.65 2.39M12 17h.01"
          />
        </svg>
      );
    default:
      return (
        <svg
          className="w-5 h-5 text-white animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      );
  }
}

/**
 * 获取状态显示文本
 */
function getStatusLabel(status: SearchProgress['status']): string {
  switch (status) {
    case 'thinking':
      return '分析需求';
    case 'searching':
      return '搜索中';
    case 'filtering':
      return '筛选结果';
    case 'done':
      return '完成';
    case 'error':
      return '出错';
    case 'question':
      return '补充需求';
    default:
      return '准备中';
  }
}

/**
 * 获取状态颜色
 */
function getStatusColor(status: SearchProgress['status']): string {
  switch (status) {
    case 'done':
      return 'bg-green-500';
    case 'error':
      return 'bg-red-500';
    case 'question':
      return 'bg-amber-500';
    default:
      return 'bg-primary';
  }
}

export const LoadingSteps: React.FC<LoadingStepsProps> = ({
  progress,
  onQuestionReply,
  isReplying = false,
}) => {
  const { status, message, currentKeywords, round, total, foundRestaurants, question } = progress;
  const [reply, setReply] = useState('');

  const submitReply = async (answer: string) => {
    const cleanedAnswer = answer.trim();
    if (!cleanedAnswer || isReplying) {
      return;
    }

    setReply('');
    await onQuestionReply?.(cleanedAnswer);
  };

  return (
    <div className="surface-panel mx-auto w-full max-w-lg rounded-[2rem] p-8">
      {/* 主状态显示 */}
      <div className="flex items-center gap-4 mb-6">
        <div
          className={`
            flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center
            ${getStatusColor(status)}
            transition-colors duration-300
          `}
        >
          <StatusIcon status={status} />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-black tracking-tight text-dark">
            {getStatusLabel(status)}
          </h3>
          <p className="mt-1 text-sm font-medium text-[#66594f]">
            {message}
          </p>
        </div>
      </div>

      {status === 'question' && question && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            {question.question}
          </p>

          {question.options && question.options.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {question.options.map((option) => (
                <Button
                  key={option}
                  variant="secondary"
                  size="md"
                  onClick={() => submitReply(option)}
                  disabled={isReplying}
                  loading={isReplying}
                  className="w-full"
                >
                  {option}
                </Button>
              ))}
            </div>
          )}

          {question.allowFreeText && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitReply(reply);
              }}
            >
              <input
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                disabled={isReplying}
                className="min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                maxLength={120}
              />
              <Button
                type="submit"
                size="md"
                disabled={!reply.trim() || isReplying}
                loading={isReplying}
              >
                继续
              </Button>
            </form>
          )}
        </div>
      )}

      {/* 搜索进度详情 */}
      {(status === 'searching' || status === 'filtering') && (
        <div className="space-y-3 mb-6">
          {/* 当前搜索关键词 */}
          {currentKeywords && currentKeywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {currentKeywords.map((keyword, index) => (
                <span
                  key={index}
                  className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary"
                >
                  {keyword}
                </span>
              ))}
            </div>
          )}

          {/* 搜索轮数和找到数量 */}
          <div className="flex items-center justify-between text-sm font-medium text-[#76695e]">
            {round && (
              <span>第 {round} 轮搜索</span>
            )}
            {total !== undefined && total > 0 && (
              <span className="font-bold text-primary">
                已找到 {total} 家
              </span>
            )}
          </div>
        </div>
      )}

      {/* 实时餐厅列表展示 */}
      {foundRestaurants && foundRestaurants.length > 0 && status !== 'done' && (
        <div className="mb-6">
          <div className="mb-2 text-xs font-bold text-[#9a8d81]">待匹配餐厅</div>
          <div className="max-h-40 overflow-y-auto space-y-2">
            {foundRestaurants.slice(0, 8).map((restaurant, index) => (
              <div
                key={restaurant.id}
                className="flex items-center justify-between rounded-2xl border border-black/10 bg-white/58 p-2 animate-fade-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-bold text-dark">
                    {restaurant.name}
                  </div>
                  <div className="text-xs font-medium text-[#76695e]">
                    {restaurant.cuisineType}
                    {restaurant.distance && (
                      <span className="ml-2">
                        {restaurant.distance < 1000
                          ? `${restaurant.distance}m`
                          : `${(restaurant.distance / 1000).toFixed(1)}km`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 w-2 h-2 bg-primary rounded-full animate-pulse" />
              </div>
            ))}
            {foundRestaurants.length > 8 && (
              <div className="py-1 text-center text-xs font-medium text-[#9a8d81]">
                还有 {foundRestaurants.length - 8} 家…
              </div>
            )}
          </div>
        </div>
      )}

      {/* 进度条 */}
      {status !== 'error' && status !== 'done' && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{
              width: status === 'thinking' ? '15%' :
                     status === 'searching' ? `${Math.min(20 + (total || 0) * 5, 75)}%` :
                     status === 'filtering' ? '90%' : '100%'
            }}
          />
        </div>
      )}

      {/* 完成状态 */}
      {status === 'done' && total !== undefined && (
        <div className="text-center py-4">
          <div className="mb-2 text-3xl font-black text-primary">
            {total}
          </div>
          <div className="text-sm font-semibold text-[#76695e]">
            家餐厅已为您准备好
          </div>
        </div>
      )}

      {/* 提示文本 */}
      {status !== 'done' && status !== 'error' && status !== 'question' && (
        <div className="mt-6 text-center">
          <p className="text-xs font-medium text-[#9a8d81]">
            AI 正在智能搜索，请稍候…
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * 兼容旧版 API 的组件
 * @deprecated 使用新的 progress 属性代替
 */
export interface LegacyLoadingStepsProps {
  step: 1 | 2;
  message?: string;
}

export const LegacyLoadingSteps: React.FC<LegacyLoadingStepsProps> = ({ step, message }) => {
  const progress: SearchProgress = {
    status: step === 1 ? 'thinking' : 'searching',
    message: message || (step === 1 ? '分析您的口味偏好…' : '查找符合条件的餐厅…'),
  };
  return <LoadingSteps progress={progress} />;
};
