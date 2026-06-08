import type { Restaurant } from '@/types';
import type { Constraint } from './types';

export type ConstraintEvaluationStatus = 'passed' | 'failed' | 'unverified';

export interface ConstraintEvaluation {
  status: ConstraintEvaluationStatus;
  message: string;
}

export function evaluateConstraint(
  restaurant: Restaurant,
  constraint: Constraint
): ConstraintEvaluation {
  if (constraint.kind === 'distance') {
    const maxMeters = getConstraintMaxMeters(constraint);
    if (maxMeters === undefined) {
      return { status: 'passed', message: '' };
    }

    if (restaurant.distance === undefined) {
      return constraint.strict
        ? { status: 'unverified', message: `${constraint.label}需要距离数据，但该餐厅距离未知。` }
        : { status: 'passed', message: `${constraint.label}缺少距离数据，已保留为候选。` };
    }

    if (restaurant.distance > maxMeters) {
      return {
        status: 'failed',
        message: `${restaurant.name}距离 ${restaurant.distance}m，超过${constraint.label} ${maxMeters}m。`,
      };
    }

    return { status: 'passed', message: '' };
  }

  if (constraint.kind === 'budget') {
    const range = getBudgetRange(constraint);
    if (!range) {
      return { status: 'passed', message: '' };
    }

    if (restaurant.averagePrice === undefined) {
      return constraint.strict
        ? { status: 'unverified', message: `${constraint.label}需要人均价格，但该餐厅价格未知。` }
        : { status: 'passed', message: '预算信息依赖餐厅人均字段；当前数据源缺失时不会编造价格。' };
    }

    if (
      (range.min !== undefined && restaurant.averagePrice < range.min)
      || (range.max !== undefined && restaurant.averagePrice > range.max)
    ) {
      return {
        status: 'failed',
        message: `${restaurant.name}人均约 ${restaurant.averagePrice} 元，不满足${constraint.label}。`,
      };
    }
  }

  if (constraint.kind === 'open_now') {
    if (restaurant.businessStatus === 'closed') {
      return { status: 'failed', message: `${restaurant.name}数据源标记为已停业或未营业。` };
    }

    if (!restaurant.businessStatus || restaurant.businessStatus === 'unknown') {
      return constraint.strict
        ? { status: 'unverified', message: `${restaurant.name}营业状态未知。` }
        : { status: 'passed', message: '营业状态未知，请出发前确认。' };
    }
  }

  return { status: 'passed', message: '' };
}

function getConstraintMaxMeters(constraint: Constraint): number | undefined {
  if (constraint.maxMeters !== undefined) {
    return constraint.maxMeters;
  }

  return typeof constraint.value === 'number' ? constraint.value : undefined;
}

function getBudgetRange(constraint: Constraint): { min?: number; max?: number } | null {
  if (constraint.min !== undefined || constraint.max !== undefined) {
    return {
      min: constraint.min,
      max: constraint.max,
    };
  }

  return typeof constraint.value === 'object' && !Array.isArray(constraint.value)
    ? constraint.value
    : null;
}
