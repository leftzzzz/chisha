// offline 模式：确定性策略 + 桩模型。
// live 模式（EVAL_MODE=live）下解除该开关，让真实模型参与决策。
if (process.env.EVAL_MODE !== 'live') {
  process.env.AGENT_DETERMINISTIC = '1'
}

// 每轮 agent 都会打一条 info 日志，20 轮下来会把评测报告冲掉。
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error'
