/**
 * 评测执行器。
 *
 * 直接驱动 runSearchAgentV3，不经过 HTTP：searchPlaces 与 emit 本来就是
 * 注入点，这让评测既快又不依赖 Next 运行时。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSearchAgentV3 } from '@/lib/agent/runtimeV3';
import type { TurnMetrics } from '@/lib/agent/metrics';
import type {
  AgentEvent,
  AgentInput,
  AgentMessage,
  AgentRuntimeState,
  SearchPlan,
} from '@/lib/agent/types';
import type { Restaurant } from '@/types';
import { beginTurn, createFixtureSearchPlaces, EVAL_LOCATION, readCounters } from './harness';
import type {
  AmapFixture,
  EvalCase,
  EvalCaseResult,
  EvalExpectation,
  EvalSuiteResult,
  EvalTurnResult,
  TurnMetricsSnapshot,
} from './types';

const CASES_DIR = join(__dirname, 'cases');
const FIXTURE_PATH = join(__dirname, 'fixtures', 'amap.json');

export function loadFixture(): AmapFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as AmapFixture;
}

export function loadCases(): EvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')) as EvalCase[]);
}

export async function runSuite(mode: 'offline' | 'live' = 'offline'): Promise<EvalSuiteResult> {
  const fixture = loadFixture();
  const searchPlaces = createFixtureSearchPlaces(fixture);
  const cases: EvalCaseResult[] = [];

  for (const evalCase of loadCases()) {
    cases.push(await runCase(evalCase, searchPlaces));
  }

  return {
    mode,
    passed: cases.filter((item) => item.passed).length,
    failed: cases.filter((item) => !item.passed).length,
    cases,
    totals: aggregate(cases),
  };
}

async function runCase(
  evalCase: EvalCase,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>
): Promise<EvalCaseResult> {
  const location = evalCase.location ?? EVAL_LOCATION;
  const messages: AgentMessage[] = [];
  let runtimeState: AgentRuntimeState | undefined;
  const turns: EvalTurnResult[] = [];

  for (const turn of evalCase.turns) {
    beginTurn({
      message: turn.message,
      goal: turn.stubGoal,
      expansion: turn.stubExpansion,
      evaluationError: turn.stubEvaluationError,
    });

    messages.push({ role: 'user', content: turn.message, createdAt: Date.now() });

    const input: AgentInput = {
      query: turn.message,
      optionId: turn.optionId,
      location,
      sessionId: `eval_${evalCase.id}`,
      messages: [...messages],
      runtimeState,
    };

    const startedAt = Date.now();
    const events: AgentEvent[] = [];
    // 失败也是一种被评测的行为：模型不可用时应当报错而不是降级瞎搜，
    // 所以这里捕获而不是让整个 suite 崩掉。
    const outcome = await runSearchAgentV3(input, (event) => events.push(event), searchPlaces)
      .then((value) => ({ result: value, error: undefined }))
      .catch((caught: unknown) => ({ result: emptyTurnResult(), error: caught }));
    const wallMs = Date.now() - startedAt;
    const result = outcome.result;

    // 失败轮不写回 runtimeState：会话状态必须保持失败前的样子。
    if (!outcome.error) {
      runtimeState = result.runtimeState;
    }
    messages.push({
      role: 'assistant',
      content: result.question?.question ?? result.explanation,
      createdAt: Date.now(),
    });

    const metrics = snapshotMetrics(result, wallMs);
    const failures = checkExpectations(turn.expect, result, metrics, outcome.error);

    turns.push({
      message: turn.message,
      passed: failures.length === 0,
      failures,
      metrics,
      primaryNames: result.restaurants.map((restaurant) => restaurant.name),
      question: result.question?.question,
    });
  }

  return {
    caseId: evalCase.id,
    description: evalCase.description,
    passed: turns.every((turn) => turn.passed),
    turns,
  };
}

type AgentTurnResult = Awaited<ReturnType<typeof runSearchAgentV3>>;

function emptyTurnResult(): AgentTurnResult {
  return {
    restaurants: [],
    candidates: [],
    explanation: '',
    unmetConstraints: [],
  };
}

function snapshotMetrics(result: AgentTurnResult, wallMs: number): TurnMetricsSnapshot {
  const counters = readCounters();
  const turnMetrics = latestTurnMetrics(result);
  const distinct = new Set(counters.evaluatedIds).size;

  return {
    askedUser: result.paused === true,
    primaryCount: result.restaurants.length,
    backupCount: result.candidates.length,
    searchRounds: result.runtimeState?.attempts.length ?? 0,
    searchSteps: (result.runtimeState?.actions ?? [])
      .filter((record) => record.action.type === 'search').length,
    searchCalls: counters.searchCalls,
    maxConcurrentSearches: counters.maxConcurrentSearches,
    plannerModelCalls: counters.plannerModelCalls,
    evaluationCalls: counters.evaluationCalls,
    evaluatedSlots: counters.evaluatedSlots,
    evaluatedDistinct: distinct,
    duplicateEvaluations: counters.evaluatedSlots - distinct,
    serialModelSteps: turnMetrics?.serialModelSteps ?? 0,
    modelCalls: turnMetrics?.modelCalls ?? 0,
    promptTokens: turnMetrics?.promptTokens ?? 0,
    completionTokens: turnMetrics?.completionTokens ?? 0,
    wallMs,
  };
}

/** 本轮的 model_call 汇总 trace 是最后写入的一条。 */
function latestTurnMetrics(result: AgentTurnResult): TurnMetrics | undefined {
  const trace = result.runtimeState?.trace ?? [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    if (trace[index].type === 'model_call') {
      return trace[index].output as TurnMetrics;
    }
  }

  return undefined;
}

function checkExpectations(
  expectation: EvalExpectation | undefined,
  result: AgentTurnResult,
  metrics: TurnMetricsSnapshot,
  error?: unknown
): string[] {
  if (!expectation) {
    return error ? [`本轮意外失败：${errorCodeOf(error)}`] : [];
  }

  const failures: string[] = [];

  if (expectation.failsWithCode) {
    const code = errorCodeOf(error);
    if (code !== expectation.failsWithCode) {
      failures.push(`应当以 ${expectation.failsWithCode} 失败，实际为 ${code ?? '成功返回'}`);
    }
  } else if (error) {
    failures.push(`本轮意外失败：${errorCodeOf(error)}`);
  }

  if (expectation.maxSearchCalls !== undefined && metrics.searchCalls > expectation.maxSearchCalls) {
    failures.push(`高德搜索 ${metrics.searchCalls} 次，超过上限 ${expectation.maxSearchCalls}`);
  }

  if (
    expectation.maxEvaluationCalls !== undefined
    && metrics.evaluationCalls > expectation.maxEvaluationCalls
  ) {
    failures.push(`候选验证 ${metrics.evaluationCalls} 次，超过上限 ${expectation.maxEvaluationCalls}`);
  }
  const cuisines = result.restaurants.map((restaurant) => restaurant.cuisineType);

  if (expectation.shouldAsk !== undefined && metrics.askedUser !== expectation.shouldAsk) {
    failures.push(
      expectation.shouldAsk
        ? '应当追问，但直接返回了推荐'
        : `不应追问，但追问了：${result.question?.question ?? ''}`
    );
  }

  if (expectation.minPrimary !== undefined && metrics.primaryCount < expectation.minPrimary) {
    failures.push(`主推荐 ${metrics.primaryCount} 家，少于要求的 ${expectation.minPrimary} 家`);
  }

  if (expectation.maxPrimary !== undefined && metrics.primaryCount > expectation.maxPrimary) {
    failures.push(`主推荐 ${metrics.primaryCount} 家，多于允许的 ${expectation.maxPrimary} 家`);
  }

  if (
    expectation.anyCuisine
    && !expectation.anyCuisine.some((cuisine) => cuisines.includes(cuisine))
  ) {
    failures.push(`主推荐缺少期望菜系 ${expectation.anyCuisine.join('/')}，实际为 ${cuisines.join('、') || '空'}`);
  }

  if (expectation.noCuisine) {
    const leaked = expectation.noCuisine.filter((cuisine) => cuisines.includes(cuisine));
    if (leaked.length > 0) {
      failures.push(`主推荐混入了不该出现的菜系 ${leaked.join('、')}`);
    }
  }

  if (
    expectation.maxSearchRounds !== undefined
    && metrics.searchRounds > expectation.maxSearchRounds
  ) {
    failures.push(`搜索轮数 ${metrics.searchRounds} 超过上限 ${expectation.maxSearchRounds}`);
  }

  if (expectation.allowDuplicateEvaluation === false && metrics.duplicateEvaluations > 0) {
    failures.push(`同一餐厅被重复送评估 ${metrics.duplicateEvaluations} 次`);
  }

  return failures;
}

function errorCodeOf(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }

  return (error as { code?: string }).code ?? 'UNKNOWN';
}

function aggregate(cases: EvalCaseResult[]): EvalSuiteResult['totals'] {
  const turns = cases.flatMap((item) => item.turns);
  const total = (pick: (metrics: TurnMetricsSnapshot) => number) =>
    turns.reduce((sum, turn) => sum + pick(turn.metrics), 0);

  return {
    searchRounds: total((metrics) => metrics.searchRounds),
    searchSteps: total((metrics) => metrics.searchSteps),
    searchCalls: total((metrics) => metrics.searchCalls),
    plannerModelCalls: total((metrics) => metrics.plannerModelCalls),
    evaluationCalls: total((metrics) => metrics.evaluationCalls),
    evaluatedSlots: total((metrics) => metrics.evaluatedSlots),
    duplicateEvaluations: total((metrics) => metrics.duplicateEvaluations),
    modelCalls: total((metrics) => metrics.modelCalls),
    serialModelSteps: total((metrics) => metrics.serialModelSteps),
    askRate: turns.length > 0
      ? Number((turns.filter((turn) => turn.metrics.askedUser).length / turns.length).toFixed(3))
      : 0,
  };
}
