/**
 * OpenAI API 调用封装
 * 用于理解用户需求并提取搜索参数
 */

import type { Location, ParsedRequirement } from '@/types';
import { ApiError } from '@/types';
import { logger } from './logger';
import { withTimeout, fetchWithTimeout } from './withTimeout';
import { ErrorCode } from './apiResponse';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const LLM_TIMEOUT = 15000; // 15 秒超时

/**
 * 系统提示词
 */
const SYSTEM_PROMPT = `你是一个餐厅搜索助手。用户会告诉你他们想吃什么，你需要提取关键信息。

请从用户的需求中提取：
1. keywords: 搜索关键词数组（如：["火锅", "川菜"]）
2. cuisineTypes: 菜系类型数组（如：["川菜", "火锅"]）
3. priceRange: 价格区间（可选），包含 min 和 max（单位：元）
4. searchRadius: 搜索半径（米），默认 2000

价格等级参考：
- 经济实惠：平均 30 元以下
- 中等价位：30-80 元
- 高档：80 元以上

搜索半径参考：
- 附近/很近：500-1000 米
- 周边：1000-2000 米
- 稍远：2000-5000 米

请以 JSON 格式返回，不要包含任何其他文字。

示例输入："我想吃附近便宜的火锅"
示例输出：
{
  "keywords": ["火锅"],
  "cuisineTypes": ["火锅"],
  "priceRange": { "max": 50 },
  "searchRadius": 1000
}`;

/**
 * 调用 OpenAI API 理解用户需求
 */
export async function callOpenAI(
  query: string,
  location?: Location
): Promise<ParsedRequirement> {
  // 检查 API Key
  if (!OPENAI_API_KEY) {
    logger.error('Missing OpenAI API Key');
    throw new ApiError(
      ErrorCode.MISSING_API_KEY,
      'OpenAI API key is not configured'
    );
  }

  // 构建用户消息
  let userMessage = query;
  if (location?.address) {
    userMessage += `\n我的位置：${location.address}`;
  }

  logger.info('Calling OpenAI API', { query, location });

  try {
    // 使用超时包装
    const result = await withTimeout(async () => {
      const response = await fetchWithTimeout(
        `${OPENAI_BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userMessage },
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
        },
        LLM_TIMEOUT
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('OpenAI API error', {
          status: response.status,
          error: errorText,
        });
        throw new ApiError(
          ErrorCode.LLM_API_ERROR,
          `OpenAI API error: ${response.status}`
        );
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new ApiError(
          ErrorCode.LLM_PARSE_ERROR,
          'No content in OpenAI response'
        );
      }

      // 解析 JSON 响应
      const parsed = JSON.parse(content.trim()) as ParsedRequirement;

      // 验证必需字段
      if (!parsed.keywords || !Array.isArray(parsed.keywords) || parsed.keywords.length === 0) {
        throw new ApiError(
          ErrorCode.LLM_PARSE_ERROR,
          'Invalid keywords in parsed result'
        );
      }

      // 设置默认值
      if (!parsed.cuisineTypes) {
        parsed.cuisineTypes = [];
      }
      if (!parsed.searchRadius) {
        parsed.searchRadius = 2000;
      }

      logger.info('OpenAI parsing successful', { parsed });
      return parsed;
    }, LLM_TIMEOUT);

    return result;
  } catch (error) {
    logger.error('OpenAI call failed', { error });

    // 如果是超时或 API 错误，尝试降级解析
    if (error instanceof Error &&
        (error.name === 'TimeoutError' ||
         (error as ApiError).code === ErrorCode.LLM_API_ERROR)) {
      logger.warn('Falling back to simple parsing');
      return fallbackParse(query);
    }

    throw error;
  }
}

/**
 * 降级解析函数
 * 当 LLM 调用失败时使用简单的关键词提取
 */
export function fallbackParse(query: string): ParsedRequirement {
  logger.info('Using fallback parsing', { query });

  const lowerQuery = query.toLowerCase();

  // 提取关键词（简单分词）
  const keywords: string[] = [];
  const cuisineTypes: string[] = [];

  // 常见菜系和关键词
  const cuisineMap: Record<string, string[]> = {
    '川菜': ['川菜', '麻辣', '火锅', '串串', '冒菜'],
    '粤菜': ['粤菜', '广东', '茶餐厅', '烧腊', '点心'],
    '湘菜': ['湘菜', '湖南'],
    '鲁菜': ['鲁菜', '山东'],
    '苏菜': ['苏菜', '江苏'],
    '浙菜': ['浙菜', '杭帮菜'],
    '闽菜': ['闽菜', '福建'],
    '徽菜': ['徽菜', '安徽'],
    '火锅': ['火锅', '涮锅'],
    '烧烤': ['烧烤', 'BBQ', 'bbq'],
    '日料': ['日料', '日本料理', '寿司', '刺身'],
    '韩餐': ['韩餐', '韩国料理', '烤肉', '石锅拌饭'],
    '西餐': ['西餐', '牛排', '意大利', '法国'],
    '快餐': ['快餐', '汉堡', '炸鸡'],
    '小吃': ['小吃', '小食', '点心'],
  };

  // 检测菜系
  for (const [cuisine, patterns] of Object.entries(cuisineMap)) {
    for (const pattern of patterns) {
      if (lowerQuery.includes(pattern)) {
        if (!cuisineTypes.includes(cuisine)) {
          cuisineTypes.push(cuisine);
        }
        if (!keywords.includes(pattern)) {
          keywords.push(pattern);
        }
      }
    }
  }

  // 如果没有匹配到菜系，使用原始查询作为关键词
  if (keywords.length === 0) {
    keywords.push(query.trim());
  }

  // 提取价格信息
  let priceRange: { min?: number; max?: number } | undefined;
  if (lowerQuery.includes('便宜') || lowerQuery.includes('实惠') || lowerQuery.includes('经济')) {
    priceRange = { max: 50 };
  } else if (lowerQuery.includes('高档') || lowerQuery.includes('奢侈') || lowerQuery.includes('贵')) {
    priceRange = { min: 80 };
  }

  // 提取距离信息
  let searchRadius = 2000; // 默认 2km
  if (lowerQuery.includes('附近') || lowerQuery.includes('很近')) {
    searchRadius = 1000;
  } else if (lowerQuery.includes('远') || lowerQuery.includes('远一点')) {
    searchRadius = 5000;
  }

  const result: ParsedRequirement = {
    keywords,
    cuisineTypes,
    priceRange,
    searchRadius,
  };

  logger.info('Fallback parsing result', { result });
  return result;
}
