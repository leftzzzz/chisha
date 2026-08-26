> 状态：历史归档。仅用于追溯，不是当前实现依据。

# Phase 2 后端 API 快速启动指南

## 步骤 1: 检查项目完整性

运行完整性检查脚本：

```bash
npm run check
```

这将验证所有必需文件是否存在。

## 步骤 2: 安装依赖

```bash
npm install
```

## 步骤 3: 配置环境变量

### 3.1 复制环境变量模板

```bash
cp .env.example .env.local
```

Windows PowerShell:
```powershell
Copy-Item .env.example .env.local
```

### 3.2 获取 API Keys

#### OpenAI API Key

1. 访问 https://platform.openai.com/
2. 注册/登录账号
3. 进入 "API keys" 页面
4. 点击 "Create new secret key"
5. 复制生成的密钥

#### 高德地图 API Key

1. 访问 https://lbs.amap.com/
2. 注册/登录账号
3. 进入"控制台" → "应用管理" → "创建新应用"
4. 添加 Key，类型选择 "Web 服务"
5. 复制生成的 Key

### 3.3 编辑 .env.local

打开 `.env.local` 文件，填写你的 API keys：

```bash
# OpenAI API Configuration
OPENAI_API_KEY=sk-proj-...  # 填写你的 OpenAI API Key
OPENAI_BASE_URL=https://api.openai.com/v1

# Amap (高德地图) API Configuration
AMAP_API_KEY=...  # 填写你的高德地图 API Key
AMAP_SECURITY_CODE=...  # 可选，如果启用了数字签名

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
LOG_LEVEL=info
```

## 步骤 4: 启动开发服务器

```bash
npm run dev
```

服务将运行在 http://localhost:3000

## 步骤 5: 测试 API

在新的终端窗口运行：

```bash
npm run test:api
```

这将测试所有 API 端点。

## 测试单个端点

### 测试理解 API

```bash
curl -X POST http://localhost:3000/api/understand \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"我想吃附近便宜的火锅\",
    \"location\": {
      \"lat\": 39.9087,
      \"lng\": 116.3975
    }
  }"
```

### 测试搜索 API

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d "{
    \"keywords\": [\"火锅\"],
    \"location\": {
      \"lat\": 39.9087,
      \"lng\": 116.3975
    },
    \"distance\": 2000
  }"
```

### 测试地理编码 API

```bash
curl -X POST http://localhost:3000/api/geocode \
  -H "Content-Type: application/json" \
  -d "{
    \"address\": \"北京市朝阳区三里屯路11号\",
    \"city\": \"北京\"
  }"
```

### 测试逆向地理编码 API

```bash
curl -X POST http://localhost:3000/api/geocode/reverse \
  -H "Content-Type: application/json" \
  -d "{
    \"location\": {
      \"lat\": 39.9087,
      \"lng\": 116.3975
    }
  }"
```

## 常见问题排查

### 问题 1: OpenAI API 调用失败

**症状**: `/api/understand` 返回错误

**解决方案**:
1. 检查 `OPENAI_API_KEY` 是否正确配置
2. 检查账号是否有足够的额度
3. 如果在国内，可能需要配置代理或使用第三方转发服务
4. 系统会自动降级到简单关键词提取，不影响基本功能

### 问题 2: 高德地图 API 调用失败

**症状**: `/api/search` 或 `/api/geocode` 返回错误

**解决方案**:
1. 检查 `AMAP_API_KEY` 是否正确配置
2. 确保 Key 的服务类型为 "Web 服务"
3. 检查 Key 是否有配额限制
4. 搜索 API 会自动降级到 OpenStreetMap

### 问题 3: 类型检查错误

**症状**: TypeScript 编译错误

**解决方案**:
```bash
npm run type-check
```

检查错误信息并修复。

### 问题 4: 端口被占用

**症状**: 启动服务器时提示端口 3000 被占用

**解决方案**:
```bash
# 方案 1: 使用其他端口
PORT=3001 npm run dev

# 方案 2: 杀死占用 3000 端口的进程
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:3000 | xargs kill -9
```

## 日志调试

### 启用详细日志

编辑 `.env.local`，设置：

```bash
LOG_LEVEL=debug
```

### 查看日志

所有日志都是 JSON 格式，便于解析：

```json
{
  "timestamp": "2025-12-13T15:30:00.000Z",
  "level": "info",
  "message": "Processing search request",
  "data": {
    "keywords": ["火锅"],
    "location": { "lat": 39.9087, "lng": 116.3975 }
  }
}
```

## 性能优化建议

1. **缓存 LLM 结果**: 相同的查询可以缓存解析结果
2. **限流**: 使用 API 网关或中间件限制请求频率
3. **监控**: 添加 Sentry 或其他监控服务
4. **CDN**: 静态资源使用 CDN 加速

## 下一步

Phase 2 完成后，可以开始 Phase 3：

1. 创建用户界面
2. 实现转盘动画
3. 集成后端 API
4. 添加交互逻辑

## 需要帮助？

- 查看完整文档: [Phase2-API-Documentation.md](./Phase2-API-Documentation.md)
- 查看项目 README: [../README.md](../README.md)
- 提交 Issue: [GitHub Issues]
