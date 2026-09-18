// 评测入口会再次按解析后的模式设置开关；这里先保证模块导入阶段不误读旧值。
const liveModes = new Set([
  'live-model-fixture-map',
  'live-model-live-map',
])

if (liveModes.has(process.env.EVAL_MODE)) {
  delete process.env.AGENT_DETERMINISTIC
} else {
  process.env.AGENT_DETERMINISTIC = '1'
}

// 每轮 agent 都会打一条 info 日志，20 轮下来会把评测报告冲掉。
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error'
