# 测试指南

## 概述

本文档介绍"今天吃啥"项目的测试策略、测试工具和测试方法。

## 测试框架

### 技术栈
- **测试运行器**：Jest 29.7
- **组件测试**：React Testing Library
- **用户交互**：@testing-library/user-event
- **断言增强**：@testing-library/jest-dom
- **测试环境**：jsdom

### 配置文件
- `jest.config.js` - Jest 配置
- `jest.setup.js` - Jest 设置文件（其中 `AGENT_DETERMINISTIC=1` 让 Agent 默认
  走确定性分支；要测模型分支的用例需在用例内删除该变量并 mock
  `@/lib/withTimeout`）
- `jest.eval.config.js` - Agent 行为评测配置（`npm run eval`，见下）

## Agent 行为评测（`npm run eval`）

单测锁的是分支，锁不住"这一轮总共搜了几步、评了几次、追没追问"。
`evals/` 用桩模型 + fixture 高德驱动真实 `runSearchAgentV3`，度量串行搜索步数、
评估调用数、重复评估数、追问率和主推荐数，并与 `evals/baseline.json` 对比。

```bash
npm run eval             # 跑 golden case，输出报告与基线 diff
npm run eval:baseline    # 同上并更新基线
EVAL_MODE=live npm run eval   # 改用真实模型（需要 OPENAI_API_KEY）
```

改 `lib/agent/orchestrator/**` / `evaluationCache.ts` 之后必须跑，
新增策略要在 `evals/cases/` 配套加 golden case。

**改子 Agent 的桩时要连契约一起改**：eval 桩若仍按旧契约返回数据，
会用旧行为掩盖新行为的差异，"基线无变化"就不再是证据（阶段 4 踩过）。

### 架构约束测试

两条约束写成了会变红的测试，不要绕过它们：

- `__tests__/lib/agent/layering.test.ts` — 依赖方向（子 Agent 不得依赖编排层、
  子 Agent 之间不得互相依赖、规则库不得反向依赖）
- `__tests__/lib/agent/subagents/subagentContracts.test.ts` — 编排状态
  （authorizations / attempts / goalVersion 等）不得出现在子 Agent 的模型输入里

## 运行测试

### 基本命令

```bash
# 运行所有测试
npm test

# 监听模式（开发推荐）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 运行特定测试文件
npm test storage.test.ts

# 运行匹配模式的测试
npm test -- --testNamePattern="搜索"
```

### 查看覆盖率报告

```bash
# 生成覆盖率
npm run test:coverage

# 在浏览器中查看
open coverage/lcov-report/index.html  # Mac
start coverage/lcov-report/index.html # Windows
```

## 测试结构

### 目录组织

```
__tests__/
├── storage.test.ts       # Storage 模块测试
├── api/                  # API 测试（待实现）
│   ├── understand.test.ts
│   ├── search.test.ts
│   └── geocode.test.ts
├── hooks/                # Hooks 测试（待实现）
│   ├── useAppState.test.ts
│   ├── useLocation.test.ts
│   └── useMediaQuery.test.ts
└── components/           # 组件测试（待实现）
    ├── Button.test.tsx
    ├── Turntable.test.tsx
    └── HistoryPage.test.tsx
```

## 已实现的测试

### Storage 测试 (`__tests__/storage.test.ts`)

#### 测试覆盖

##### 1. 基础功能测试
```typescript
describe('Storage - 基础功能', () => {
  test('getRecords - 空历史记录')
  test('saveRecord - 保存新记录')
  test('deleteRecord - 删除记录')
  test('clearRecords - 清空所有记录')
});
```

##### 2. 搜索功能测试
```typescript
describe('Storage - 搜索功能', () => {
  test('searchHistory - 搜索餐厅名称')
  test('searchHistory - 空关键词返回所有记录')
});
```

##### 3. 统计功能测试
```typescript
describe('Storage - 统计功能', () => {
  test('getStats - 空记录返回零值')
  test('getStats - 统计最常去的餐厅')
});
```

##### 4. 导入导出测试
```typescript
describe('Storage - 导入导出', () => {
  test('exportHistory - 导出为JSON')
  test('importHistory - 导入JSON数据')
  test('importHistory - 去重合并')
});
```

##### 5. 边界情况测试
```typescript
describe('Storage - 边界情况', () => {
  test('保存记录数量限制')
  test('删除不存在的记录')
  test('导入无效JSON')
});
```

#### 运行示例

```bash
npm test storage.test.ts

# 输出：
PASS  __tests__/storage.test.ts
  Storage - 基础功能
    ✓ getRecords - 空历史记录 (2 ms)
    ✓ saveRecord - 保存新记录 (1 ms)
    ✓ deleteRecord - 删除记录 (1 ms)
    ✓ clearRecords - 清空所有记录 (1 ms)
  Storage - 搜索功能
    ✓ searchHistory - 搜索餐厅名称 (2 ms)
    ✓ searchHistory - 空关键词返回所有记录 (1 ms)
  ...

Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
```

## 编写测试指南

### 1. 单元测试模板

```typescript
import { functionToTest } from '@/lib/module';

describe('模块名 - 功能描述', () => {
  // 每个测试前执行
  beforeEach(() => {
    // 初始化测试数据
  });

  // 每个测试后执行
  afterEach(() => {
    // 清理测试环境
  });

  test('应该正确处理正常情况', () => {
    // Arrange - 准备测试数据
    const input = 'test';

    // Act - 执行测试函数
    const result = functionToTest(input);

    // Assert - 验证结果
    expect(result).toBe('expected');
  });

  test('应该正确处理边界情况', () => {
    expect(() => functionToTest(null)).toThrow();
  });
});
```

### 2. 组件测试模板（待实现）

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

describe('Button 组件', () => {
  test('应该正确渲染', () => {
    render(<Button>点击</Button>);
    expect(screen.getByText('点击')).toBeInTheDocument();
  });

  test('应该响应点击事件', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>点击</Button>);

    fireEvent.click(screen.getByText('点击'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  test('禁用状态不应响应点击', () => {
    const handleClick = jest.fn();
    render(
      <Button disabled onClick={handleClick}>
        点击
      </Button>
    );

    fireEvent.click(screen.getByText('点击'));
    expect(handleClick).not.toHaveBeenCalled();
  });
});
```

### 3. Hooks 测试模板（待实现）

```typescript
import { renderHook, act } from '@testing-library/react';
import { useAppState } from '@/hooks/useAppState';

describe('useAppState Hook', () => {
  test('应该返回初始状态', () => {
    const { result } = renderHook(() => useAppState());

    expect(result.current.state.step).toBe('INPUT');
    expect(result.current.state.restaurants).toEqual([]);
  });

  test('应该更新查询', () => {
    const { result } = renderHook(() => useAppState());

    act(() => {
      result.current.setQuery('我想吃火锅');
    });

    expect(result.current.state.userQuery).toBe('我想吃火锅');
  });
});
```

## Mock 使用指南

### 1. Mock localStorage

```typescript
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});
```

### 2. Mock fetch

```typescript
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: 'test' }),
  })
) as jest.Mock;

// 使用后清理
afterEach(() => {
  jest.restoreAllMocks();
});
```

### 3. Mock 环境变量

```typescript
const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    AMAP_KEY: 'test-key',
  };
});

afterEach(() => {
  process.env = originalEnv;
});
```

## 最佳实践

### 1. 测试命名
- 使用描述性名称
- 说明测试的功能和预期
- 格式：`应该/应该正确 + 动作 + 结果`

```typescript
✅ test('应该在输入为空时返回空数组')
✅ test('应该正确处理无效的 JSON 格式')
❌ test('测试1')
❌ test('it works')
```

### 2. AAA 模式
- **Arrange**（准备）：设置测试数据
- **Act**（执行）：调用被测函数
- **Assert**（断言）：验证结果

```typescript
test('示例', () => {
  // Arrange
  const input = 'test';
  const expected = 'TEST';

  // Act
  const result = toUpperCase(input);

  // Assert
  expect(result).toBe(expected);
});
```

### 3. 独立性
- 每个测试独立运行
- 不依赖其他测试
- 使用 beforeEach/afterEach 清理

```typescript
let testData;

beforeEach(() => {
  testData = createTestData(); // 每次都重新创建
});

afterEach(() => {
  cleanup(); // 清理副作用
});
```

### 4. 测试覆盖
- 正常情况
- 边界情况
- 错误情况
- 异步情况

```typescript
describe('功能测试', () => {
  test('正常情况')
  test('空输入')
  test('无效输入')
  test('超大输入')
  test('异步成功')
  test('异步失败')
});
```

## 覆盖率目标

### 全局目标
- 总体覆盖率：≥ 70%
- 分支覆盖率：≥ 70%
- 函数覆盖率：≥ 70%
- 语句覆盖率：≥ 70%

### 模块目标
| 模块 | 目标 | 优先级 |
|------|------|--------|
| lib/ | ≥ 80% | 高 |
| hooks/ | ≥ 70% | 高 |
| components/ui/ | ≥ 60% | 中 |
| components/功能/ | ≥ 60% | 中 |
| app/ | ≥ 50% | 低 |

## 常用断言

### Jest 断言

```typescript
// 相等性
expect(value).toBe(expected);           // 严格相等 ===
expect(value).toEqual(expected);        // 深度相等
expect(value).not.toBe(expected);       // 不相等

// 真假性
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeDefined();

// 数字
expect(number).toBeGreaterThan(3);
expect(number).toBeLessThan(5);
expect(number).toBeCloseTo(0.3);        // 浮点数

// 字符串
expect(string).toMatch(/pattern/);
expect(string).toContain('substring');

// 数组
expect(array).toContain(item);
expect(array).toHaveLength(3);

// 对象
expect(object).toHaveProperty('key');
expect(object).toMatchObject({ key: 'value' });

// 异常
expect(() => fn()).toThrow();
expect(() => fn()).toThrow('error message');

// 异步
await expect(promise).resolves.toBe(value);
await expect(promise).rejects.toThrow();
```

### Testing Library 断言

```typescript
// DOM 查询
screen.getByText('text');               // 存在且唯一
screen.queryByText('text');             // 可能不存在
screen.findByText('text');              // 异步查找

// 断言
expect(element).toBeInTheDocument();
expect(element).toBeVisible();
expect(element).toBeDisabled();
expect(element).toHaveClass('class-name');
expect(element).toHaveAttribute('attr', 'value');
expect(input).toHaveValue('value');
```

## 调试技巧

### 1. 查看 DOM 结构

```typescript
import { screen, render } from '@testing-library/react';

test('调试', () => {
  render(<Component />);
  screen.debug(); // 打印整个 DOM
  screen.debug(screen.getByRole('button')); // 打印特定元素
});
```

### 2. 使用 test.only

```typescript
test.only('只运行这个测试', () => {
  // 只运行这一个测试
});
```

### 3. 查看失败详情

```bash
npm test -- --verbose
```

### 4. 使用 VSCode 断点

在 `.vscode/launch.json` 中添加：

```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--no-cache"],
  "console": "integratedTerminal"
}
```

## 待实现的测试

### 高优先级
- [ ] API 端点测试
  - [ ] `/api/understand`
  - [ ] `/api/search`
  - [ ] `/api/geocode`
- [ ] Hooks 测试
  - [ ] `useAppState`
  - [ ] `useLocation`
  - [ ] `useMediaQuery`

### 中优先级
- [ ] UI 组件测试
  - [ ] Button
  - [ ] Input
  - [ ] Modal
  - [ ] Card
- [ ] 功能组件测试
  - [ ] Turntable
  - [ ] SearchPanel
  - [ ] RestaurantCard

### 低优先级
- [ ] 页面测试
  - [ ] HomePage
  - [ ] HistoryPage
- [ ] E2E 测试
  - [ ] 完整用户流程
  - [ ] 跨页面交互

## 参考资源

### 文档
- [Jest 官方文档](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Testing Library 备忘单](https://testing-library.com/docs/react-testing-library/cheatsheet)

### 示例
- 项目中的 `__tests__/storage.test.ts`
- React Testing Library [示例](https://testing-library.com/docs/react-testing-library/example-intro)

## 总结

好的测试应该：
- ✅ 快速运行
- ✅ 独立可靠
- ✅ 易于维护
- ✅ 清晰明了
- ✅ 覆盖关键路径

记住：**测试不是负担，而是信心的来源！**
