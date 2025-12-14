/**
 * useTurntable - 转盘逻辑 Hook
 *
 * 管理转盘的旋转动画和结果选择
 *
 * 特性:
 * - 随机选择餐厅索引
 * - 计算旋转角度和动画时长
 * - 自动状态转移(READY → SPINNING → RESULT)
 * - 支持自定义动画时长
 * - 旋转动画结束后自动回调
 *
 * 使用方式:
 * ```tsx
 * const {
 *   isSpinning,
 *   selectedIndex,
 *   rotation,
 *   startSpin,
 * } = useTurntable(restaurants.length);
 * ```
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppState } from './useAppState';

/**
 * 转盘配置
 */
const TURNTABLE_CONFIG = {
  minDuration: 3000, // 最小旋转时长(毫秒)
  maxDuration: 5000, // 最大旋转时长(毫秒)
  minRotations: 3, // 最少旋转圈数
  maxRotations: 5, // 最多旋转圈数
};

/**
 * useTurntable Hook 返回值
 */
export interface UseTurntableReturn {
  isSpinning: boolean; // 是否正在旋转
  selectedIndex: number; // 选中的索引 (-1 表示未选中)
  rotation: number; // 当前旋转角度(度)
  spinDuration: number; // 旋转动画时长(毫秒)
  startSpin: () => void; // 开始旋转
  reset: () => void; // 重置转盘
}

/**
 * useTurntable Hook
 *
 * 转盘旋转逻辑
 *
 * @param itemCount - 转盘项目数量(餐厅数量)
 * @returns 转盘状态和控制方法
 *
 * @example
 * ```tsx
 * function Turntable() {
 *   const { state } = useAppState();
 *   const {
 *     isSpinning,
 *     rotation,
 *     spinDuration,
 *     startSpin,
 *   } = useTurntable(state.restaurants.length);
 *
 *   return (
 *     <div
 *       className="turntable"
 *       style={{
 *         transform: `rotate(${rotation}deg)`,
 *         transition: `transform ${spinDuration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`,
 *       }}
 *     >
 *       {state.restaurants.map((restaurant, index) => (
 *         <div key={index}>{restaurant.name}</div>
 *       ))}
 *       <button onClick={startSpin} disabled={isSpinning}>
 *         开始
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTurntable(itemCount: number): UseTurntableReturn {
  const { state, setStep, setSelectedIndex } = useAppState();

  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinDuration, setSpinDuration] = useState(TURNTABLE_CONFIG.minDuration);

  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * 清理定时器
   */
  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
      }
    };
  }, []);

  /**
   * 开始旋转
   */
  const startSpin = useCallback(() => {
    // 验证状态
    if (state.step !== 'READY' && state.step !== 'RESULT') {
      console.warn('Cannot spin: not in READY or RESULT state');
      return;
    }

    if (itemCount < 3) {
      console.warn('Cannot spin: not enough items');
      return;
    }

    if (isSpinning) {
      console.warn('Already spinning');
      return;
    }

    // 开始旋转
    setIsSpinning(true);
    setStep('SPINNING');

    // 随机选择目标索引
    const targetIndex = Math.floor(Math.random() * itemCount);

    // 计算目标角度
    // 注意：每个扇形占用 anglePerItem 度，该扇形的中心角是 startAngle + anglePerItem/2
    // 但扇形的 startAngle 是 index * anglePerItem，减去 90° 的偏移后才是实际位置
    // 所以扇形中心的实际位置是 (index * anglePerItem - 90) + anglePerItem/2 = (index + 0.5) * anglePerItem - 90
    // 要让指针指向该中心，转盘需要旋转使得该中心移到指针位置（-90°）
    // 所以转盘旋转角度应该是 -(targetIndex + 0.5) * anglePerItem
    const anglePerItem = 360 / itemCount;
    const targetAngle = -(targetIndex + 0.5) * anglePerItem;

    // 随机旋转圈数
    const rotations =
      Math.floor(Math.random() * (TURNTABLE_CONFIG.maxRotations - TURNTABLE_CONFIG.minRotations + 1)) +
      TURNTABLE_CONFIG.minRotations;

    // 最终旋转角度 = 完整圈数 + 目标角度
    const finalRotation = rotations * 360 + targetAngle;

    // 随机动画时长
    const duration =
      Math.floor(
        Math.random() * (TURNTABLE_CONFIG.maxDuration - TURNTABLE_CONFIG.minDuration + 1)
      ) + TURNTABLE_CONFIG.minDuration;

    // 应用旋转
    setRotation(finalRotation);
    setSpinDuration(duration);

    // 旋转结束后的回调
    spinTimeoutRef.current = setTimeout(() => {
      setIsSpinning(false);
      setSelectedIndex(targetIndex);
      setStep('RESULT');
    }, duration);
  }, [state.step, itemCount, isSpinning, setStep, setSelectedIndex]);

  /**
   * 重置转盘
   */
  const reset = useCallback(() => {
    if (spinTimeoutRef.current) {
      clearTimeout(spinTimeoutRef.current);
      spinTimeoutRef.current = null;
    }

    setIsSpinning(false);
    setRotation(0);
    setSpinDuration(TURNTABLE_CONFIG.minDuration);
    setSelectedIndex(-1);
  }, [setSelectedIndex]);

  return {
    isSpinning,
    selectedIndex: state.selectedIndex,
    rotation,
    spinDuration,
    startSpin,
    reset,
  };
}

/**
 * 计算转盘项目的位置
 *
 * 辅助函数,用于在圆形转盘上均匀分布项目
 *
 * @param index - 项目索引
 * @param total - 总项目数
 * @param radius - 半径(像素)
 * @returns 项目的 x, y 坐标和旋转角度
 *
 * @example
 * ```tsx
 * const { x, y, rotation } = calculateItemPosition(0, 8, 200);
 * // x: 200, y: 0, rotation: 0
 * ```
 */
export function calculateItemPosition(
  index: number,
  total: number,
  radius: number
): { x: number; y: number; rotation: number } {
  const anglePerItem = (2 * Math.PI) / total;
  const angle = anglePerItem * index;

  return {
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle),
    rotation: (angle * 180) / Math.PI,
  };
}
