#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const wranglerCommand = process.env.WRANGLER_COMMAND || '';
const shouldRunRemoteMigrations = /^(deploy|versions upload)\b/.test(wranglerCommand);
const isBuildDryRun = process.env.WRANGLER_BUILD_DRY_RUN === '1';
const isWranglerDryRun = /\s--dry-run\b/.test(` ${wranglerCommand}`);
const shouldSkipRemoteMigrations = process.env.SKIP_D1_MIGRATIONS === '1'
  || isBuildDryRun
  || isWranglerDryRun;
const workerEntry = '.open-next/worker.js';
const assetsDirectory = '.open-next/assets';
const buildInputs = [
  'app',
  'components',
  'context',
  'hooks',
  'lib',
  'styles',
  'types',
  'next.config.js',
  'open-next.config.ts',
  'package.json',
  'package-lock.json',
  'postcss.config.js',
  'tailwind.config.ts',
  'tsconfig.json',
  'wrangler.jsonc',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (shouldRunRemoteMigrations && !shouldSkipRemoteMigrations) {
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'chisha', '--remote']);
} else {
  console.log(`[wrangler build] Skip remote D1 migrations for WRANGLER_COMMAND="${wranglerCommand}"`);
}

if (isBuildDryRun) {
  console.log('[wrangler build] Dry run complete');
  process.exit(0);
}

if (canReuseOpenNextBuild()) {
  console.log(`[wrangler build] Reuse existing ${workerEntry}`);
} else {
  run('npx', ['@opennextjs/cloudflare', 'build']);
}

function canReuseOpenNextBuild() {
  if (!existsSync(workerEntry) || !existsSync(assetsDirectory)) {
    return false;
  }

  const workerMtime = statSync(workerEntry).mtimeMs;
  return !buildInputs.some((input) => hasFileNewerThan(input, workerMtime));
}

function hasFileNewerThan(path, mtimeMs) {
  if (!existsSync(path)) {
    return false;
  }

  if (path.includes('node_modules') || path.includes('.next') || path.includes('.open-next')) {
    return false;
  }

  const stats = statSync(path);
  if (stats.isFile()) {
    return stats.mtimeMs > mtimeMs;
  }

  if (!stats.isDirectory()) {
    return false;
  }

  return readdirSync(path).some((entry) => hasFileNewerThan(join(path, entry), mtimeMs));
}
