/**
 * 评测报告与基线对比。
 *
 * 基线不是通过门槛，而是"这次改动把哪些量改动了"的可读 diff。
 * 通过与否由 case 的 expect 决定，基线只负责让指标变化无处可藏。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalSuiteResult } from './types';

const BASELINE_PATH = join(__dirname, 'baseline.json');

interface Baseline {
  updatedAt: string;
  totals: EvalSuiteResult['totals'];
  cases: Record<string, {
    passed: boolean;
    searchSteps: number;
    searchRounds: number;
    duplicateEvaluations: number;
    primaryCount: number;
  }>;
}

export function formatReport(result: EvalSuiteResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`Agent eval（${result.mode}）：${result.passed} 通过 / ${result.failed} 失败`);
  lines.push('');
  lines.push(padRow(['case', '结果', '步', '词', '评估', '重复', '主推', '并发']));
  lines.push(padRow(['—'.repeat(24), '—'.repeat(4), '—'.repeat(3), '—'.repeat(3), '—'.repeat(4), '—'.repeat(4), '—'.repeat(4), '—'.repeat(4)]));

  for (const item of result.cases) {
    const metrics = item.turns[item.turns.length - 1]?.metrics;
    lines.push(padRow([
      item.caseId,
      item.passed ? 'PASS' : 'FAIL',
      String(sumTurns(item, 'searchSteps')),
      String(sumTurns(item, 'searchRounds')),
      String(sumTurns(item, 'evaluationCalls')),
      String(sumTurns(item, 'duplicateEvaluations')),
      String(metrics?.primaryCount ?? 0),
      String(Math.max(...item.turns.map((turn) => turn.metrics.maxConcurrentSearches), 0)),
    ]));

    for (const turn of item.turns) {
      for (const failure of turn.failures) {
        lines.push(`    ✗ 「${turn.message}」${failure}`);
      }
    }
  }

  lines.push('');
  lines.push('合计：'
    + `串行搜索步 ${result.totals.searchSteps}`
    + ` / 搜索关键词 ${result.totals.searchRounds}`
    + ` / planner 模型决策 ${result.totals.plannerModelCalls}`
    + ` / 评估调用 ${result.totals.evaluationCalls}`
    + ` / 重复评估 ${result.totals.duplicateEvaluations}`
    + ` / 追问率 ${result.totals.askRate}`);

  return lines.join('\n');
}

export function compareWithBaseline(result: EvalSuiteResult): string {
  if (!existsSync(BASELINE_PATH)) {
    return '（无基线，跳过对比。用 EVAL_UPDATE_BASELINE=1 生成）';
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  const lines: string[] = [`基线对比（${baseline.updatedAt}）：`];

  for (const [key, current] of Object.entries(result.totals)) {
    const previous = baseline.totals[key as keyof EvalSuiteResult['totals']];
    if (previous !== current) {
      lines.push(`  ${key}: ${previous} → ${current} ${delta(previous, current)}`);
    }
  }

  for (const item of result.cases) {
    const previous = baseline.cases[item.caseId];
    if (!previous) {
      lines.push(`  + 新增 case ${item.caseId}`);
      continue;
    }

    const steps = sumTurns(item, 'searchSteps');
    const rounds = sumTurns(item, 'searchRounds');
    const duplicates = sumTurns(item, 'duplicateEvaluations');
    const primary = item.turns[item.turns.length - 1]?.metrics.primaryCount ?? 0;

    if (previous.passed !== item.passed) {
      lines.push(`  ${item.caseId}: ${previous.passed ? 'PASS' : 'FAIL'} → ${item.passed ? 'PASS' : 'FAIL'}`);
    }
    if (previous.searchSteps !== steps) {
      lines.push(`  ${item.caseId} 串行搜索步: ${previous.searchSteps} → ${steps}`);
    }
    if (previous.searchRounds !== rounds) {
      lines.push(`  ${item.caseId} 搜索关键词: ${previous.searchRounds} → ${rounds}`);
    }
    if (previous.duplicateEvaluations !== duplicates) {
      lines.push(`  ${item.caseId} 重复评估: ${previous.duplicateEvaluations} → ${duplicates}`);
    }
    if (previous.primaryCount !== primary) {
      lines.push(`  ${item.caseId} 主推荐: ${previous.primaryCount} → ${primary}`);
    }
  }

  return lines.length === 1 ? '基线对比：无变化' : lines.join('\n');
}

export function writeBaseline(result: EvalSuiteResult): void {
  const baseline: Baseline = {
    updatedAt: new Date().toISOString().slice(0, 10),
    totals: result.totals,
    cases: Object.fromEntries(result.cases.map((item) => [
      item.caseId,
      {
        passed: item.passed,
        searchSteps: sumTurns(item, 'searchSteps'),
        searchRounds: sumTurns(item, 'searchRounds'),
        duplicateEvaluations: sumTurns(item, 'duplicateEvaluations'),
        primaryCount: item.turns[item.turns.length - 1]?.metrics.primaryCount ?? 0,
      },
    ])),
  };

  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

function sumTurns(
  item: EvalSuiteResult['cases'][number],
  key: 'searchSteps' | 'searchRounds' | 'searchCalls' | 'evaluationCalls' | 'duplicateEvaluations'
): number {
  return item.turns.reduce((sum, turn) => sum + turn.metrics[key], 0);
}

function delta(previous: number, current: number): string {
  const diff = current - previous;
  return diff > 0 ? `(+${diff})` : `(${diff})`;
}

function padRow(cells: string[]): string {
  const widths = [26, 6, 5, 5, 6, 6, 6, 6];
  return cells.map((cell, index) => padEndWide(cell, widths[index] ?? 8)).join('').trimEnd();
}

/** 中文字符按两个宽度计算，否则表格会错位。 */
function padEndWide(value: string, width: number): string {
  let displayWidth = 0;
  for (const char of value) {
    displayWidth += char.charCodeAt(0) > 0x2e80 ? 2 : 1;
  }

  return value + ' '.repeat(Math.max(1, width - displayWidth));
}
