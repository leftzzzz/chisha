/**
 * 评测入口。
 *
 * 用 jest 当运行器只是为了拿到 TS 转译与 @/ 别名——这里不是单测：
 * 断言只有一条"全部 case 通过"，真正的产出是控制台报告与基线 diff。
 *
 * 离线运行：npm run eval
 * 真实模型 + fixture 地图：npm run eval:live-model-fixture-map
 * 更新基线：npm run eval:baseline
 */

jest.mock('@/lib/agent/models/goalUnderstandingModel', () => {
  const actual = jest.requireActual('@/lib/agent/models/goalUnderstandingModel');
  const harness = jest.requireActual('@/evals/harness');

  return {
    ...actual,
    runGoalUnderstandingModel: (input: unknown, context?: unknown) =>
      harness.routeGoalUnderstanding(actual, input, context),
  };
});

jest.mock('@/lib/agent/models/keywordExpansionModel', () => {
  const actual = jest.requireActual('@/lib/agent/models/keywordExpansionModel');
  const harness = jest.requireActual('@/evals/harness');

  return {
    ...actual,
    runKeywordExpansionModel: (input: unknown) =>
      harness.routeKeywordExpansion(actual, input),
  };
});

jest.mock('@/lib/agent/models/evaluationModel', () => {
  const actual = jest.requireActual('@/lib/agent/models/evaluationModel');
  const harness = jest.requireActual('@/evals/harness');

  return {
    ...actual,
    runEvaluationModel: (input: unknown) =>
      harness.routeEvaluation(actual, input),
  };
});

import { resolveEvalMode } from './config';
import { compareWithBaseline, formatReport, writeBaseline } from './report';
import { runSuite } from './runner';

describe('agent eval suite', () => {
  it('runs every golden case', async () => {
    const mode = resolveEvalMode();
    const result = await runSuite(mode);

    console.log(formatReport(result));
    if (mode === 'offline') {
      console.log(`\n${compareWithBaseline(result)}\n`);
    } else {
      console.log('\n真实调用模式不与 offline baseline 比较。\n');
    }

    if (process.env.EVAL_UPDATE_BASELINE === '1') {
      writeBaseline(result);
      console.log('已更新 evals/baseline.json');
    }

    expect(result.failed).toBe(0);
  }, 120000);
});
