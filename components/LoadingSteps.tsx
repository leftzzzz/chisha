/**
 * LoadingSteps 组件
 *
 * 多步骤加载进度显示
 */

import React from 'react';

export interface LoadingStepsProps {
  step: 1 | 2;
  message?: string;
}

const STEPS = [
  { id: 1, label: '理解您的需求', description: '分析您的口味偏好...' },
  { id: 2, label: '搜索附近餐厅', description: '查找符合条件的餐厅...' },
];

export const LoadingSteps: React.FC<LoadingStepsProps> = ({ step, message }) => {
  return (
    <div className="w-full max-w-md mx-auto p-8 bg-white rounded-lg shadow-lg">
      {/* 进度条 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">处理中</span>
          <span className="text-sm font-medium text-primary">
            {step}/2
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-primary h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${(step / 2) * 100}%` }}
          />
        </div>
      </div>

      {/* 步骤列表 */}
      <div className="space-y-4">
        {STEPS.map((s) => {
          const isActive = s.id === step;
          const isCompleted = s.id < step;

          return (
            <div
              key={s.id}
              className={`
                flex items-start gap-4 p-4 rounded-lg transition-all duration-300
                ${isActive ? 'bg-primary/5 border-2 border-primary' : 'bg-gray-50 border-2 border-transparent'}
                ${isCompleted ? 'opacity-60' : ''}
              `}
            >
              {/* 图标 */}
              <div
                className={`
                  flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                  ${isCompleted ? 'bg-green-500' : isActive ? 'bg-primary' : 'bg-gray-300'}
                  transition-colors duration-300
                `}
              >
                {isCompleted ? (
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
                ) : isActive ? (
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
                ) : (
                  <span className="text-sm font-bold text-white">{s.id}</span>
                )}
              </div>

              {/* 文本 */}
              <div className="flex-1 min-w-0">
                <h3
                  className={`
                    text-sm font-semibold
                    ${isActive ? 'text-primary' : 'text-gray-700'}
                  `}
                >
                  {s.label}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {isActive && message ? message : s.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 提示文本 */}
      <div className="mt-6 text-center">
        <p className="text-sm text-gray-500">
          请稍候，正在为您寻找最佳餐厅...
        </p>
      </div>
    </div>
  );
};
