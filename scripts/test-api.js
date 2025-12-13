#!/usr/bin/env node

/**
 * API 测试脚本
 * 用于快速测试所有后端 API 端点
 *
 * 使用方法:
 *   node scripts/test-api.js
 */

const API_BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// ANSI 颜色代码
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

async function testEndpoint(name, url, body) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`Testing: ${name}`, 'blue');
  log(`Endpoint: POST ${url}`, 'yellow');
  log(`Request:`, 'yellow');
  console.log(JSON.stringify(body, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    log(`\nResponse (${response.status}):`, 'yellow');
    console.log(JSON.stringify(data, null, 2));

    if (data.success) {
      log(`✓ ${name} - SUCCESS`, 'green');
    } else {
      log(`✗ ${name} - FAILED`, 'red');
    }

    return data;
  } catch (error) {
    log(`✗ ${name} - ERROR: ${error.message}`, 'red');
    return null;
  }
}

async function main() {
  log('Starting API Tests...', 'cyan');
  log(`API Base URL: ${API_BASE}\n`, 'yellow');

  // 测试位置（北京三里屯）
  const testLocation = {
    lat: 39.9087,
    lng: 116.3975,
    address: '北京市朝阳区三里屯',
  };

  // 1. 测试理解 API
  const understandResult = await testEndpoint(
    'Understand User Query',
    `${API_BASE}/api/understand`,
    {
      query: '我想吃附近便宜的火锅',
      location: testLocation,
    }
  );

  // 2. 测试搜索 API（使用理解结果）
  if (understandResult?.success) {
    const parsed = understandResult.data.parsed;
    await testEndpoint(
      'Search Restaurants',
      `${API_BASE}/api/search`,
      {
        keywords: parsed.keywords,
        location: testLocation,
        distance: parsed.searchRadius,
        cuisineTypes: parsed.cuisineTypes,
        priceRange: parsed.priceRange,
        count: 8,
      }
    );
  } else {
    // 直接测试搜索
    await testEndpoint(
      'Search Restaurants (Direct)',
      `${API_BASE}/api/search`,
      {
        keywords: ['火锅'],
        location: testLocation,
        distance: 2000,
      }
    );
  }

  // 3. 测试地理编码
  await testEndpoint(
    'Geocode Address',
    `${API_BASE}/api/geocode`,
    {
      address: '北京市朝阳区三里屯路11号',
      city: '北京',
    }
  );

  // 4. 测试逆向地理编码
  await testEndpoint(
    'Reverse Geocode',
    `${API_BASE}/api/geocode/reverse`,
    {
      location: testLocation,
    }
  );

  log('\n' + '='.repeat(60), 'cyan');
  log('All tests completed!', 'green');
  log('\nNote: Some tests may fail if API keys are not configured.', 'yellow');
}

main().catch(error => {
  log(`Fatal error: ${error.message}`, 'red');
  process.exit(1);
});
