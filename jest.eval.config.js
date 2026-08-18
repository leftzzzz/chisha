/**
 * 评测集运行配置。
 *
 * 与单测分开：评测跑真实 loop、耗时更长、不参与覆盖率门槛，
 * 也不加载 jest.setup.js（AGENT_DETERMINISTIC 由评测自己控制）。
 */

const nextJest = require('next/jest')

const createJestConfig = nextJest({ dir: './' })

module.exports = createJestConfig({
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^nanoid$': '<rootDir>/__mocks__/nanoid.js',
  },
  testMatch: ['**/evals/**/*.eval.ts'],
  testPathIgnorePatterns: ['<rootDir>/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  setupFiles: ['<rootDir>/evals/setup.js'],
  testTimeout: 120000,
})
