#!/usr/bin/env node

/**
 * 项目完整性检查脚本
 * 验证 Phase 2 的所有文件是否存在且符合要求
 */

const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

const requiredFiles = [
  // 类型定义
  { path: 'types/index.ts', description: '核心类型定义' },

  // 工具库
  { path: 'lib/validation.ts', description: 'Zod 验证 Schemas' },
  { path: 'lib/apiResponse.ts', description: '统一 API 响应格式' },
  { path: 'lib/logger.ts', description: '日志工具' },
  { path: 'lib/withTimeout.ts', description: '超时中间件' },
  { path: 'lib/llm.ts', description: 'OpenAI API 兼容封装' },
  { path: 'lib/agent/supervisor.ts', description: 'SearchSupervisorAgent' },
  { path: 'lib/agent/subagents/planningAgent.ts', description: 'PlanningAgent' },
  { path: 'lib/agent/subagents/evaluationAgent.ts', description: 'EvaluationAgent' },
  { path: 'lib/agent/poiTaxonomy.ts', description: '高德 POI Taxonomy' },
  { path: 'lib/agent/guards.ts', description: 'Agent Runtime Guards' },
  { path: 'lib/amap.ts', description: '高德地图 API 封装' },
  { path: 'lib/osm.ts', description: 'OpenStreetMap API 封装' },
  { path: 'lib/distance.ts', description: '距离计算工具' },
  { path: 'lib/dataTransform.ts', description: '数据转换和合并' },

  // API 路由
  { path: 'app/api/agent/chat/route.ts', description: '多轮 Agent 对话搜索 API' },
  { path: 'app/api/agent/search/route.ts', description: 'Agent 搜索 API' },
  { path: 'app/api/search/route.ts', description: '餐厅搜索 API' },
  { path: 'app/api/geocode/route.ts', description: '地理编码 API' },
  { path: 'app/api/geocode/reverse/route.ts', description: '逆向地理编码 API' },

  // 配置文件
  { path: 'package.json', description: 'NPM 配置文件' },
  { path: 'tsconfig.json', description: 'TypeScript 配置' },
  { path: '.env.example', description: '环境变量模板' },
  { path: '.gitignore', description: 'Git 忽略配置' },

  // 文档
  { path: 'README.md', description: '项目说明' },
  { path: 'docs/Phase2-API-Documentation.md', description: 'API 文档' },
];

const requiredEnvVars = [
  { name: 'OPENAI_API_KEY', required: true, description: 'OpenAI API 密钥' },
  { name: 'AMAP_API_KEY', required: true, description: '高德地图 API 密钥' },
  { name: 'OPENAI_BASE_URL', required: false, description: 'OpenAI API 基础 URL' },
  { name: 'AMAP_SECURITY_CODE', required: false, description: '高德地图安全码' },
  { name: 'NEXT_PUBLIC_APP_URL', required: false, description: '应用 URL' },
  { name: 'LOG_LEVEL', required: false, description: '日志级别' },
  { name: 'AGENT_SUPERVISOR_V2', required: false, description: '启用 Supervisor + 子 Agent 搜索链路' },
];

function checkFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  return fs.existsSync(fullPath);
}

function checkEnvFile() {
  const envPath = path.join(process.cwd(), '.env.local');
  return fs.existsSync(envPath);
}

function loadEnvVars() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const vars = {};

  content.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key) {
        vars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });

  return vars;
}

function main() {
  log('\n' + '='.repeat(70), 'cyan');
  log('Phase 2 后端 API - 完整性检查', 'cyan');
  log('='.repeat(70) + '\n', 'cyan');

  let allPassed = true;
  let filesPassed = 0;
  let filesFailed = 0;

  // 检查文件
  log('1. 检查必需文件...', 'blue');
  log('');

  requiredFiles.forEach(({ path: filePath, description }) => {
    const exists = checkFile(filePath);
    if (exists) {
      log(`  ✓ ${filePath}`, 'green');
      log(`    ${description}`, 'reset');
      filesPassed++;
    } else {
      log(`  ✗ ${filePath} (缺失)`, 'red');
      log(`    ${description}`, 'reset');
      filesFailed++;
      allPassed = false;
    }
  });

  log('');
  log(`文件检查结果: ${filesPassed} 通过, ${filesFailed} 失败`, filesFailed > 0 ? 'yellow' : 'green');
  log('');

  // 检查环境变量
  log('2. 检查环境变量配置...', 'blue');
  log('');

  const hasEnvFile = checkEnvFile();
  if (!hasEnvFile) {
    log('  ⚠ .env.local 文件不存在', 'yellow');
    log('    请复制 .env.example 到 .env.local 并配置 API keys', 'yellow');
    log('');
  } else {
    log('  ✓ .env.local 文件存在', 'green');
    log('');

    const envVars = loadEnvVars();
    let envPassed = 0;
    let envFailed = 0;
    let envWarning = 0;

    requiredEnvVars.forEach(({ name, required, description }) => {
      const value = envVars[name];
      const hasValue = value && value.length > 0 && !value.includes('...');

      if (required) {
        if (hasValue) {
          log(`  ✓ ${name}`, 'green');
          log(`    ${description} - 已配置`, 'reset');
          envPassed++;
        } else {
          log(`  ✗ ${name} (未配置)`, 'red');
          log(`    ${description} - 必需配置`, 'reset');
          envFailed++;
          allPassed = false;
        }
      } else {
        if (hasValue) {
          log(`  ✓ ${name}`, 'green');
          log(`    ${description} - 已配置`, 'reset');
          envPassed++;
        } else {
          log(`  ⚠ ${name} (未配置)`, 'yellow');
          log(`    ${description} - 可选配置`, 'reset');
          envWarning++;
        }
      }
    });

    log('');
    log(`环境变量检查结果: ${envPassed} 通过, ${envFailed} 失败, ${envWarning} 警告`,
        envFailed > 0 ? 'yellow' : 'green');
  }

  // 检查 TypeScript 配置
  log('');
  log('3. 检查 TypeScript 配置...', 'blue');
  log('');

  try {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf-8')
    );

    if (tsconfig.compilerOptions?.strict) {
      log('  ✓ TypeScript strict mode 已启用', 'green');
    } else {
      log('  ⚠ TypeScript strict mode 未启用', 'yellow');
    }

    if (tsconfig.compilerOptions?.paths?.['@/*']) {
      log('  ✓ 路径别名 @/* 已配置', 'green');
    } else {
      log('  ⚠ 路径别名 @/* 未配置', 'yellow');
    }
  } catch {
    log('  ✗ tsconfig.json 解析失败', 'red');
    allPassed = false;
  }

  // 检查 package.json
  log('');
  log('4. 检查 NPM 依赖...', 'blue');
  log('');

  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    );

    const requiredDeps = ['next', 'react', 'react-dom', 'zod'];
    const missingDeps = requiredDeps.filter(dep => !pkg.dependencies?.[dep]);

    if (missingDeps.length === 0) {
      log('  ✓ 所有必需依赖已声明', 'green');
    } else {
      log(`  ✗ 缺失依赖: ${missingDeps.join(', ')}`, 'red');
      allPassed = false;
    }

    // 检查是否已安装
    const nodeModulesExists = fs.existsSync(path.join(process.cwd(), 'node_modules'));
    if (nodeModulesExists) {
      log('  ✓ node_modules 已存在', 'green');
    } else {
      log('  ⚠ node_modules 不存在，请运行 npm install', 'yellow');
    }
  } catch {
    log('  ✗ package.json 解析失败', 'red');
    allPassed = false;
  }

  // 总结
  log('');
  log('='.repeat(70), 'cyan');

  if (allPassed && hasEnvFile) {
    log('✓ 所有检查通过！Phase 2 后端 API 已完整实现', 'green');
    log('');
    log('下一步:', 'cyan');
    log('  1. 确保已安装依赖: npm install', 'yellow');
    log('  2. 启动开发服务器: npm run dev', 'yellow');
    log('  3. 运行 API 测试: npm run test:api', 'yellow');
  } else {
    log('✗ 检查未完全通过，请修复上述问题', 'red');
    log('');
    log('快速修复步骤:', 'cyan');

    if (filesFailed > 0) {
      log('  1. 确保所有必需文件已创建', 'yellow');
    }

    if (!hasEnvFile) {
      log('  2. 复制环境变量模板: cp .env.example .env.local', 'yellow');
      log('  3. 编辑 .env.local 填写 API keys', 'yellow');
    }

    log('  4. 安装依赖: npm install', 'yellow');
  }

  log('='.repeat(70) + '\n', 'cyan');

  process.exit(allPassed ? 0 : 1);
}

main();
