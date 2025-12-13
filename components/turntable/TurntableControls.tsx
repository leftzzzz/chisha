/**
 * TurntableControls 组件
 *
 * 转盘控制按钮组
 */

import React from 'react';
import { Restaurant } from '@/types';
import { Button } from '@/components/ui';

export interface TurntableControlsProps {
  isSpinning: boolean;
  selectedRestaurant: Restaurant | null;
  onSpin: () => void;
  onRemove?: () => void;
  onSave?: () => void;
  onRetry?: () => void;
  onClose?: () => void;
  disabled?: boolean;
}

export const TurntableControls: React.FC<TurntableControlsProps> = ({
  isSpinning,
  selectedRestaurant,
  onSpin,
  onRemove,
  onSave,
  onRetry,
  onClose,
  disabled = false,
}) => {
  // 是否显示结果按钮（已选中且不在旋转）
  const showResultButtons = selectedRestaurant && !isSpinning;

  return (
    <div className="w-full space-y-3">
      {!showResultButtons ? (
        // 转动按钮
        <div className="flex justify-center">
          <Button
            variant="primary"
            size="lg"
            onClick={onSpin}
            disabled={disabled || isSpinning}
            loading={isSpinning}
            className="min-w-[200px]"
            ariaLabel={isSpinning ? '转动中' : '开始转动'}
          >
            {isSpinning ? '转动中...' : '开始转动'}
          </Button>
        </div>
      ) : (
        // 结果操作按钮
        <div className="space-y-2">
          {/* 主要操作 */}
          <div className="grid grid-cols-2 gap-3">
            {onSave && (
              <Button
                variant="success"
                size="md"
                onClick={onSave}
                disabled={disabled}
                ariaLabel="保存到历史记录"
              >
                <svg
                  className="w-5 h-5 mr-2"
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
                保存历史
              </Button>
            )}
            {onRemove && (
              <Button
                variant="danger"
                size="md"
                onClick={onRemove}
                disabled={disabled}
                ariaLabel="不想去这家"
              >
                <svg
                  className="w-5 h-5 mr-2"
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
                不想去
              </Button>
            )}
          </div>

          {/* 次要操作 */}
          <div className="grid grid-cols-2 gap-3">
            {onRetry && (
              <Button
                variant="secondary"
                size="md"
                onClick={onRetry}
                disabled={disabled}
                ariaLabel="再来一次"
              >
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                再来一次
              </Button>
            )}
            {onClose && (
              <Button
                variant="secondary"
                size="md"
                onClick={onClose}
                disabled={disabled}
                ariaLabel="返回搜索"
              >
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                返回
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 提示信息 */}
      {selectedRestaurant && !isSpinning && (
        <div className="text-center">
          <p className="text-sm text-gray-600">
            就决定是你了！
          </p>
        </div>
      )}
    </div>
  );
};
