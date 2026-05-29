#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/wrangler-without-migrations.js <wrangler args...>');
  process.exit(1);
}

const result = spawnSync('npx', ['wrangler', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    SKIP_D1_MIGRATIONS: '1',
  },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
