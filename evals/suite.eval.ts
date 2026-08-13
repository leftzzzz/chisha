/**
 * 评测入口。
 *
 * 用 jest 当运行器只是为了拿到 TS 转译与 @/ 别名——这里不是单测：
 * 断言只有一条"全部 case 通过"，真正的产出是控制台报告与基线 diff。
 *
 * 运行：npm run eval
 * 更新基线：EVAL_UPDATE_BASELINE=1 npm run eval
 */

jest.mock('@/lib/agent/supervisorPlanner', () => {
  const actual = jest.requireActual('@/lib/agent/supervisorPlanner');
  const harness = jest.requireActual('@/evals/harness');

  return {
    ...actual,
    runSupervisorPlanner: (input: unknown, context?: unknown) =>
      harness.routeSupervisorPlanner(actual, input, context),
  };
});

jest.mock('@/lib/agent/subagents/keywordExpansionAgent', () => {
  const actual = jest.requireActual('@/lib/agent/subagents/keywordExpansionAgent');
  const harness = jest.requireActual('@/evals/harness');

  return {
    ...actual,
    runKeywordExpansionAgent: () => harness.keywordExpansionStub(),
  };
});

jest.mock('@/lib/agent/subagents/evaluationAgent', () => {
  const harness = jest.requireActual('@/evals/harness');

  return {
    runEvaluationAgent: (input: unknown) => harness.evaluationStub(input),
  };
});

import { compareWithBaseline, formatReport, writeBaseline } from './report';
import { runSuite } from './runner';

describe('agent eval suite', () => {
  it('runs every golden case', async () => {
    const result = await runSuite('offline');

    console.log(formatReport(result));
    console.log(`\n${compareWithBaseline(result)}\n`);

    if (process.env.EVAL_UPDATE_BASELINE === '1') {
      writeBaseline(result);
      console.log('已更新 evals/baseline.json');
    }

    expect(result.failed).toBe(0);
  }, 120000);
});
