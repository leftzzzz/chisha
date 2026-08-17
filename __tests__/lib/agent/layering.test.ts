/**
 * 分层约束，写成可执行的形式。
 *
 * 这次重构要修的漂移（编排决策散到三处、模型角色反向吸收策略），上一轮是
 * 用文档约束的——文档不会在 CI 里变红。这组用例扫源码里的 import，把方向
 * 约束变成会失败的测试。
 *
 * 允许的边只有三条：
 *   orchestrator → models / 规则库 / 工具层
 *   models    → 规则库 / modelClient
 *   规则库        → 规则库
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const AGENT_ROOT = resolve(__dirname, '../../../lib/agent');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return listSourceFiles(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** 取一个文件里所有 import 的模块说明符。 */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf-8');
  return Array.from(source.matchAll(/from\s+'([^']+)'/g)).map((match) => match[1]);
}

/** 把 import 说明符解析成 lib/agent 下的相对路径；外部依赖返回 null。 */
function resolveAgentModule(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const target = resolve(file, '..', specifier);
    return target.startsWith(AGENT_ROOT) ? relative(AGENT_ROOT, target) : null;
  }

  if (specifier.startsWith('@/lib/agent/')) {
    return specifier.slice('@/lib/agent/'.length);
  }

  return null;
}

interface Edge {
  from: string;
  to: string;
}

const edges: Edge[] = listSourceFiles(AGENT_ROOT).flatMap((file) => {
  const from = relative(AGENT_ROOT, file);
  return importsOf(file)
    .map((specifier) => resolveAgentModule(file, specifier))
    .filter((target): target is string => target !== null)
    .map((to) => ({ from, to }));
});

const isOrchestrator = (path: string) => path.startsWith('orchestrator/');
const isModelRole = (path: string) => path.startsWith('models/');
const isRule = (path: string) => !isOrchestrator(path) && !isModelRole(path);

function describeEdges(violations: Edge[]): string[] {
  return violations.map((edge) => `${edge.from} → ${edge.to}`);
}

describe('agent 分层依赖方向', () => {
  it('扫到了依赖边（防止正则失效导致全部用例空跑）', () => {
    expect(edges.length).toBeGreaterThan(30);
  });

  it('模型角色不依赖编排层', () => {
    // 模型角色一旦 import policy/runtime，就说明它开始参与流程决策了。
    const violations = edges.filter((edge) => isModelRole(edge.from) && isOrchestrator(edge.to));
    expect(describeEdges(violations)).toEqual([]);
  });

  it('模型角色之间互不依赖', () => {
    // 每个模型角色只做一件独立任务；互相调用意味着它们在私下编排。
    const violations = edges.filter((edge) =>
      isModelRole(edge.from)
      && isModelRole(edge.to)
      && edge.from !== edge.to
    );
    expect(describeEdges(violations)).toEqual([]);
  });

  it('规则库不依赖编排层或模型角色', () => {
    // 规则库要被两边复用；反向依赖会立刻制造循环，也会让纯函数拖着模型调用。
    const violations = edges.filter((edge) =>
      isRule(edge.from)
      && (isOrchestrator(edge.to) || isModelRole(edge.to))
    );
    expect(describeEdges(violations)).toEqual([]);
  });

  it('policy 不直接依赖模型', () => {
    // 决策必须是纯函数：能不 mock 就单测。碰 modelClient 或模型角色即破坏该性质。
    const violations = edges.filter((edge) =>
      edge.from === 'orchestrator/policy.ts'
      && (isModelRole(edge.to) || edge.to.startsWith('modelClient'))
    );
    expect(describeEdges(violations)).toEqual([]);
  });
});
