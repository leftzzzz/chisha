/**
 * OpenAI API 调用封装
 * 用于理解用户需求并提取搜索参数
 * 使用 Function Calling 来确保格式化输出
 */

import type { Location, ParsedRequirement } from '@/types';
import { ApiError } from '@/types';
import { logger } from './logger';
import { withTimeout, fetchWithTimeout } from './withTimeout';
import { ErrorCode } from './apiResponse';
import { JSON_FUNCTION_MAX_TOKENS } from './agent/modelClient';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const LLM_TIMEOUT = 30000; // 30 秒超时

/**
 * 系统提示词
 * 用于引导 LLM 正确理解用户需求并调用函数
 * 必须使用 Function Calling 来返回结果
 */
const SYSTEM_PROMPT = `你是一个餐厅搜索助手。你的唯一任务是调用 parseRestaurantSearchQuery 函数来处理用户的餐厅搜索需求。

## 重要说明
1. 你必须调用 parseRestaurantSearchQuery 函数
2. 不要输出任何其他文本、解释或回复
3. 只能使用函数调用来返回结果

## 你需要理解的信息
1. 搜索关键词：用户想找什么餐厅（如：火锅、日料、烧烤等）
2. 菜系类型：餐厅的菜系分类
3. 价格范围：用户对价格的预期
   - 便宜/实惠：max 50 左右
   - 中等：30-80 元
   - 高档/贵：min 80 以上
4. 搜索范围：离用户多近的餐厅
   - 附近/很近：500-1000米
   - 周边：1000-2000米
   - 稍远：2000-5000米

## POI 类型代码（重要！）
poiType 是高德地图的 POI 分类代码，用于精确过滤搜索结果。你需要根据用户需求决定是否使用：

### 何时使用 poiType
- 用户明确指定具体菜系时（如"川菜"、"日料"）
- 用户需要特定类型餐厅时（如"火锅"、"咖啡"）

### 何时不使用 poiType（留空）
- 用户需求模糊（如"附近有什么吃的"、"随便吃点"）
- 口味偏好扩展时（如"清淡的"、"辣的"）
- 搜索多种类型时

### 常用 POI 类型代码参考
中餐厅（050100）：
- 050102 川菜 | 050103 粤菜 | 050104 鲁菜 | 050105 苏菜
- 050106 浙菜 | 050107 上海菜 | 050108 湘菜 | 050109 徽菜
- 050110 闽菜 | 050111 北京菜 | 050112 湖北菜 | 050113 东北菜
- 050114 云贵菜 | 050115 西北菜 | 050117 火锅
- 050119 海鲜 | 050120 素菜 | 050121 清真 | 050122 台湾菜 | 050123 潮州菜

外国餐厅（050200）：
- 050201 西餐厅 | 050202 日本料理 | 050203 韩国料理
- 050206 泰国/越南菜 | 050205 意大利菜 | 050209 印度菜

快餐厅（050300）：
- 050300 快餐厅 | 050305 茶餐厅 | 050306 面包甜点

休闲饮品/甜品：
- 050500 咖啡厅 | 050600 茶艺馆 | 050700 冷饮店
- 050800 糕饼店 | 050900 甜品店

其他：
- 050000 餐饮服务（最宽泛，包含所有餐饮）

## 口味偏好扩展（重要！）
当用户输入模糊的口味偏好而非具体菜系时，你必须将其扩展为具体的餐厅类型关键词，比如：
- 清淡/不油腻 → 粤菜、江浙菜、日料、轻食、沙拉
- 辣/重口味/刺激 → 川菜、湘菜、火锅、烧烤
- 健康/养生/低卡 → 轻食、沙拉、素食、养生粥
- 快/赶时间/简单 → 快餐、面馆、简餐
- 想喝点/饮品 → 咖啡、奶茶、饮品
- 甜的/甜点 → 甜品、蛋糕、烘焙
- 家常 → 中餐、家常菜、炒菜
- 意义不明的需求 -> 你来替用户决定推荐哪些餐厅

扩展后的关键词应全部放入 keywords 数组中。

## cuisineTypes 使用规则（非常重要！）
cuisineTypes 只能填写高德地图标准的大菜系分类，例如：川菜、粤菜、湘菜、日料、韩餐、西餐、火锅、烧烤等。

以下情况 cuisineTypes 必须为空数组 []：
1. 口味偏好扩展时（如"清淡"、"辣"等）
2. 细分品类搜索时（如奶茶、咖啡、披萨、汉堡、蛋糕、面包、沙拉、寿司、拉面、烤鸭、小龙虾等）
3. 具体食物名称搜索时（如牛肉面、酸菜鱼、麻辣烫等）

原因：这些细分品类的关键词搜索已经足够精准，额外的 cuisineTypes 过滤会导致结果被错误过滤掉（因为高德返回的分类名称可能不包含用户搜索的关键词）。

## 示例
用户输入: "我想吃附近便宜的火锅"
必须调用: parseRestaurantSearchQuery({
  "keywords": ["火锅"],
  "cuisineTypes": ["火锅"],
  "priceRange": {"max": 50},
  "searchRadius": 1000,
  "poiType": "050117"
})

用户输入: "推荐个高档的日料餐厅"
必须调用: parseRestaurantSearchQuery({
  "keywords": ["日料"],
  "cuisineTypes": ["日料"],
  "priceRange": {"min": 80},
  "searchRadius": 2000,
  "poiType": "050202"
})

用户输入: "我想吃清淡点的"
必须调用: parseRestaurantSearchQuery({
  "keywords": ["粤菜", "江浙菜", "日料", "轻食", "沙拉"],
  "cuisineTypes": [],
  "searchRadius": 2000
})

用户输入: "想吃辣的"
必须调用: parseRestaurantSearchQuery({
  "keywords": ["川菜", "湘菜", "火锅", "烧烤"],
  "cuisineTypes": [],
  "searchRadius": 2000
})

用户输入: "想喝奶茶"
必须调用: parseRestaurantSearchQuery({
  "keywords": ["奶茶"],
  "cuisineTypes": [],
  "searchRadius": 2000,
  "poiType": "050700"
})

用户输入: "附近有咖啡店吗"
必须调用: parseRestaurantSearchQuery({
  "keywords": ["咖啡"],
  "cuisineTypes": [],
  "searchRadius": 1000,
  "poiType": "050500"
})

用户输入: "想吃披萨"
必须调用: parseRestaurantSearchQuery({
  "keywords": ["披萨"],
  "cuisineTypes": [],
  "searchRadius": 2000
})

用户输入: "附近有什么吃的"
必须调用: parseRestaurantSearchQuery({
  "keywords": ["餐厅", "美食"],
  "cuisineTypes": [],
  "searchRadius": 1000
})`;

/**
 * Function Calling 的函数定义（使用旧版 functions 格式，兼容性更好）
 */
const FUNCTIONS = [
  {
    name: 'parseRestaurantSearchQuery',
    description: '解析用户的餐厅搜索查询，提取搜索参数。必须调用此函数来返回结果。',
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '搜索关键词数组，如：火锅、日料、烧烤、清淡等',
        },
        cuisineTypes: {
          type: 'array',
          items: { type: 'string' },
          description: '菜系类型数组，如：川菜、粤菜、日料等',
        },
        priceRange: {
          type: 'object',
          properties: {
            min: { type: 'number', description: '最低价格（元）' },
            max: { type: 'number', description: '最高价格（元）' },
          },
          description: '价格范围对象，min 和 max 都是可选的',
        },
        searchRadius: {
          type: 'number',
          description: '搜索半径，单位为米，默认 2000',
        },
        poiType: {
          type: 'string',
          description: '高德 POI 类型代码（如 050117 火锅、050202 日料、050500 咖啡、050700 冷饮/奶茶），用于精确过滤。模糊搜索或多类型搜索时不填',
        },
      },
      required: ['keywords'],
    },
  },
];

/**
 * 调用 OpenAI API 理解用户需求（使用 Function Calling）
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

  logger.info('Calling OpenAI API with Function Calling', {
    query,
    location,
    baseUrl: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
  });

  try {
    // 使用超时包装
    const result = await withTimeout(async () => {
      const url = `${OPENAI_BASE_URL}/chat/completions`;
      logger.info('Sending request to OpenAI', { url, model: OPENAI_MODEL });

      const response = await fetchWithTimeout(
        `${OPENAI_BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
              // 当前api不支持system prompt
              // { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: SYSTEM_PROMPT + '\n' + userMessage },
            ],
            functions: FUNCTIONS,
            function_call: { name: 'parseRestaurantSearchQuery' },
            temperature: 0,
            max_tokens: JSON_FUNCTION_MAX_TOKENS,
          }),
        },
        LLM_TIMEOUT
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('OpenAI API error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });

        // 尝试解析错误响应中的详细信息
        let detailedError: string;
        try {
          const errorData = JSON.parse(errorText);
          detailedError = errorData.error?.message || `OpenAI API error: ${response.status}`;
        } catch {
          detailedError = `OpenAI API error: ${response.status} - ${errorText}`;
        }
        throw new ApiError(ErrorCode.LLM_API_ERROR, detailedError);
      }

      let data: {
        choices?: Array<{
          message?: {
            content?: string;
            function_call?: {
              name: string;
              arguments: string;
            };
            tool_calls?: Array<{
              type: string;
              function: {
                name: string;
                arguments: string;
              };
            }>;
          };
        }>;
      };
      try {
        data = await response.json();
      } catch {
        const responseText = await response.text();
        logger.error('Failed to parse JSON response', {
          statusCode: response.status,
          responseLength: responseText.length,
          firstChars: responseText.substring(0, 200),
        });
        throw new ApiError(
          ErrorCode.LLM_API_ERROR,
          `Invalid JSON response from OpenAI API: ${responseText.substring(0, 100)}`
        );
      }

      // 检查是否有 function_call（旧版格式）或 tool_calls（新版格式）
      const message = data.choices?.[0]?.message;
      const functionCall = message?.function_call;
      const toolCalls = message?.tool_calls;
      const content = message?.content;

      let functionName: string | undefined;
      let functionArgs: string | undefined;

      if (functionCall) {
        // 旧版 function_call 格式
        functionName = functionCall.name;
        functionArgs = functionCall.arguments;
      } else if (toolCalls && toolCalls.length > 0) {
        // 新版 tool_calls 格式
        const toolCall = toolCalls[0];
        if (toolCall.type === 'function') {
          functionName = toolCall.function.name;
          functionArgs = toolCall.function.arguments;
        }
      } else if (content) {
        // 某些 API 不支持 function calling，会把函数调用作为文本返回
        // 尝试从文本中解析函数调用，格式如: parseRestaurantSearchQuery({...})
        // 需要处理可能包含 <think> 标签的情况
        logger.info('Attempting to parse function call from text content', {
          contentLength: content.length,
          contentPreview: content.substring(0, 200),
        });

        // 方法：找到所有 parseRestaurantSearchQuery( 的位置，然后手动匹配括号
        const funcName = 'parseRestaurantSearchQuery';
        let searchStart = 0;
        let lastValidArgs: string | undefined;

        while (true) {
          const funcIndex = content.indexOf(funcName + '(', searchStart);
          if (funcIndex === -1) break;

          const argsStart = funcIndex + funcName.length + 1; // 跳过 "parseRestaurantSearchQuery("

          // 找到匹配的 JSON 对象
          let braceCount = 0;
          let jsonStart = -1;
          let jsonEnd = -1;

          for (let i = argsStart; i < content.length; i++) {
            const char = content[i];
            if (char === '{') {
              if (braceCount === 0) jsonStart = i;
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }

          if (jsonStart !== -1 && jsonEnd !== -1) {
            const jsonStr = content.substring(jsonStart, jsonEnd);
            try {
              JSON.parse(jsonStr);
              lastValidArgs = jsonStr;
            } catch {
              // 无效的 JSON，继续查找
            }
          }

          searchStart = funcIndex + 1;
        }

        if (lastValidArgs) {
          logger.info('Successfully parsed function call from text content');
          functionName = 'parseRestaurantSearchQuery';
          functionArgs = lastValidArgs;
        }
      }

      if (!functionName || !functionArgs) {
        logger.error('No function call in OpenAI response', { data });
        throw new ApiError(
          ErrorCode.LLM_PARSE_ERROR,
          'LLM did not call the required function'
        );
      }

      if (functionName !== 'parseRestaurantSearchQuery') {
        logger.error('Unexpected function call', { functionName });
        throw new ApiError(
          ErrorCode.LLM_PARSE_ERROR,
          `Unexpected function call: ${functionName}`
        );
      }

      // 解析函数参数
      let parsed: ParsedRequirement;
      try {
        parsed = typeof functionArgs === 'string' ? JSON.parse(functionArgs) : functionArgs;
      } catch (parseError) {
        logger.error('Failed to parse function arguments', {
          arguments: functionArgs,
          error: parseError,
        });
        throw new ApiError(
          ErrorCode.LLM_PARSE_ERROR,
          'Failed to parse LLM function arguments'
        );
      }

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

      logger.info('Function calling successful', { parsed });
      return parsed;
    }, LLM_TIMEOUT);

    return result;
  } catch (error) {
    const errorCode = error instanceof ApiError ? error.code : undefined;

    // 改进错误捕获和日志
    if (error instanceof Error) {
      logger.error('OpenAI call failed', {
        name: error.name,
        message: error.message,
        code: errorCode,
      });
    } else {
      logger.error('OpenAI call failed', { error: String(error) });
    }

    // 如果是超时、API 错误或解析错误，尝试降级解析
    if (error instanceof Error &&
        (error.name === 'TimeoutError' ||
         errorCode === ErrorCode.LLM_API_ERROR ||
         errorCode === ErrorCode.LLM_PARSE_ERROR)) {
      logger.warn('Falling back to simple parsing', {
        errorName: error.name,
        errorCode,
      });
      return fallbackParse(query);
    }

    throw error;
  }
}

/**
 * 口味偏好到具体关键词的映射
 * 注意：cuisines 字段已弃用，口味偏好扩展时不应使用 cuisineTypes 过滤
 */
const TASTE_PREFERENCE_MAP: Record<string, { keywords: string[] }> = {
  '清淡': { keywords: ['粤菜', '江浙菜', '日料', '轻食', '沙拉'] },
  '不油腻': { keywords: ['粤菜', '江浙菜', '日料', '轻食', '沙拉'] },
  '辣': { keywords: ['川菜', '湘菜', '火锅', '烧烤'] },
  '重口味': { keywords: ['川菜', '湘菜', '火锅', '烧烤'] },
  '刺激': { keywords: ['川菜', '湘菜', '火锅', '烧烤'] },
  '健康': { keywords: ['轻食', '沙拉', '素食', '养生粥'] },
  '养生': { keywords: ['轻食', '沙拉', '素食', '养生粥'] },
  '低卡': { keywords: ['轻食', '沙拉', '素食', '养生粥'] },
  '快': { keywords: ['快餐', '面馆', '简餐'] },
  '赶时间': { keywords: ['快餐', '面馆', '简餐'] },
  '简单': { keywords: ['快餐', '面馆', '简餐'] },
  '喝点': { keywords: ['咖啡', '奶茶', '饮品'] },
  '饮品': { keywords: ['咖啡', '奶茶', '饮品'] },
  '甜': { keywords: ['甜品', '蛋糕', '烘焙'] },
  '甜点': { keywords: ['甜品', '蛋糕', '烘焙'] },
  '家常': { keywords: ['中餐', '家常菜', '炒菜'] },
  '随便': { keywords: ['中餐', '家常菜', '炒菜'] },
};

/**
 * 细分品类列表
 * 这些品类只作为搜索关键词，不应作为 cuisineTypes 过滤条件
 */
const SUBCATEGORY_KEYWORDS = [
  '奶茶', '咖啡', '披萨', '汉堡', '蛋糕', '面包', '沙拉', '寿司', '拉面',
  '烤鸭', '小龙虾', '牛肉面', '酸菜鱼', '麻辣烫', '冒菜', '串串', '烤肉',
  '炸鸡', '甜品', '冰淇淋', '奶酪', '三明治', '热狗', '薯条', '鸡排',
  '珍珠奶茶', '果茶', '柠檬茶', '酸奶', '果汁', '冰沙', '奶昔',
];

/**
 * 大菜系分类列表
 * 只有这些分类可以作为 cuisineTypes 过滤条件
 */
const MAJOR_CUISINE_TYPES = [
  '川菜', '粤菜', '湘菜', '鲁菜', '苏菜', '浙菜', '闽菜', '徽菜',
  '日料', '韩餐', '西餐', '东南亚菜', '泰国菜', '越南菜', '印度菜',
  '火锅', '烧烤', '中餐', '家常菜', '快餐', '面馆',
];

/**
 * 降级解析函数
 * 当 LLM 调用失败时使用简单的关键词提取
 */
export function fallbackParse(query: string): ParsedRequirement {
  logger.info('Using fallback parsing', { query });

  const lowerQuery = query.toLowerCase();

  // 提取关键词（简单分词）
  const keywords: string[] = [];
  let cuisineTypes: string[] = [];
  let isSubcategorySearch = false;

  // 首先检测细分品类关键词
  for (const subcategory of SUBCATEGORY_KEYWORDS) {
    if (lowerQuery.includes(subcategory.toLowerCase())) {
      if (!keywords.includes(subcategory)) {
        keywords.push(subcategory);
      }
      isSubcategorySearch = true;
    }
  }

  // 如果是细分品类搜索，不需要继续检测
  if (isSubcategorySearch) {
    // 细分品类搜索时 cuisineTypes 保持为空
    logger.info('Detected subcategory search, skipping cuisineTypes', { keywords });
  } else {
    // 检测口味偏好并扩展
    for (const [preference, mapping] of Object.entries(TASTE_PREFERENCE_MAP)) {
      if (lowerQuery.includes(preference)) {
        for (const kw of mapping.keywords) {
          if (!keywords.includes(kw)) {
            keywords.push(kw);
          }
        }
        // 口味偏好扩展时不填充 cuisineTypes，避免二次过滤
      }
    }

    // 如果口味偏好已匹配，跳过菜系检测
    if (keywords.length === 0) {
      // 常见菜系和关键词
      const cuisineMap: Record<string, string[]> = {
        '川菜': ['川菜', '麻辣'],
        '粤菜': ['粤菜', '广东', '茶餐厅', '烧腊', '点心'],
        '湘菜': ['湘菜', '湖南'],
        '鲁菜': ['鲁菜', '山东'],
        '苏菜': ['苏菜', '江苏'],
        '浙菜': ['浙菜', '杭帮菜'],
        '闽菜': ['闽菜', '福建'],
        '徽菜': ['徽菜', '安徽'],
        '火锅': ['火锅', '涮锅'],
        '烧烤': ['烧烤', 'BBQ', 'bbq'],
        '日料': ['日料', '日本料理'],
        '韩餐': ['韩餐', '韩国料理', '石锅拌饭'],
        '西餐': ['西餐', '牛排', '意大利', '法国'],
        '快餐': ['快餐'],
        '中餐': ['中餐', '家常菜', '炒菜'],
      };

      // 检测菜系（只有大菜系才填充 cuisineTypes）
      for (const [cuisine, patterns] of Object.entries(cuisineMap)) {
        for (const pattern of patterns) {
          if (lowerQuery.includes(pattern.toLowerCase())) {
            // 只有当 cuisine 属于大菜系分类时才添加到 cuisineTypes
            if (MAJOR_CUISINE_TYPES.includes(cuisine) && !cuisineTypes.includes(cuisine)) {
              cuisineTypes.push(cuisine);
            }
            if (!keywords.includes(pattern)) {
              keywords.push(pattern);
            }
          }
        }
      }
    }
  }

  // 如果没有匹配到任何内容，使用原始查询作为关键词
  if (keywords.length === 0) {
    keywords.push(query.trim());
    // 对于未识别的查询，不填充 cuisineTypes
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
