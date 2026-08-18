#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/wrangler-deploy-with-migrations.js <wrangler args...>');
  process.exit(1);
}

const isDryRun = args.includes('--dry-run') || process.env.SKIP_D1_MIGRATIONS === '1';
if (!isDryRun) {
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'chisha', '--remote']);
} else {
  console.log('[wrangler deploy] Skip remote D1 migrations for dry-run/explicit skip');
}

run('npx', ['wrangler', ...args], {
  ...process.env,
  SKIP_D1_MIGRATIONS: '1',
});

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
