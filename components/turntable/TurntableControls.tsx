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
  onRetry?: () => void;
  onShare?: () => void;
  disabled?: boolean;
}

export const TurntableControls: React.FC<TurntableControlsProps> = ({
  isSpinning,
  selectedRestaurant,
  onSpin,
  onRemove,
  onRetry,
  onShare,
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
        <div className="grid grid-cols-3 gap-2">
          {onRetry && (
            <Button
              variant="secondary"
              size="md"
              onClick={onRetry}
              disabled={disabled}
              ariaLabel="再来一次"
            >
              <svg
                className="w-5 h-5 sm:mr-1.5"
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
              <span className="hidden sm:inline">再来一次</span>
            </Button>
          )}
          {onShare && (
            <Button
              variant="secondary"
              size="md"
              onClick={onShare}
              disabled={disabled}
              ariaLabel="分享转盘"
            >
              <svg
                className="w-5 h-5 sm:mr-1.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                />
              </svg>
              <span className="hidden sm:inline">分享</span>
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
                className="w-5 h-5 sm:mr-1.5"
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
              <span className="hidden sm:inline">不想去</span>
            </Button>
          )}
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
