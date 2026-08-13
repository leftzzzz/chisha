// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Agent 默认走确定性分支。
// 需要覆盖模型决策路径的用例请在用例内 delete process.env.AGENT_DETERMINISTIC 并 mock fetch。
process.env.AGENT_DETERMINISTIC = '1'
