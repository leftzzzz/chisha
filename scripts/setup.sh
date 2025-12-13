#!/bin/bash

# 今天吃啥 - 一键安装脚本
# 此脚本将帮助您快速设置项目环境

set -e  # 遇到错误立即退出

echo "================================"
echo "  今天吃啥 - 项目设置向导"
echo "================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Node.js
echo "检查 Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未找到 Node.js${NC}"
    echo "请先安装 Node.js 18.0 或更高版本"
    echo "访问: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}错误: Node.js 版本过低${NC}"
    echo "当前版本: $(node -v)"
    echo "需要版本: v18.0.0 或更高"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v) 已安装${NC}"

# 检查 npm
echo "检查 npm..."
if ! command -v npm &> /dev/null; then
    echo -e "${RED}错误: 未找到 npm${NC}"
    exit 1
fi

echo -e "${GREEN}✓ npm $(npm -v) 已安装${NC}"
echo ""

# 安装依赖
echo "安装项目依赖..."
echo "这可能需要几分钟时间..."
npm install

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 依赖安装成功${NC}"
else
    echo -e "${RED}✗ 依赖安装失败${NC}"
    exit 1
fi
echo ""

# 检查环境变量文件
echo "配置环境变量..."
if [ ! -f .env.local ]; then
    if [ -f .env.example ]; then
        cp .env.example .env.local
        echo -e "${GREEN}✓ 已创建 .env.local 文件${NC}"
        echo -e "${YELLOW}⚠ 请编辑 .env.local 文件并填写您的 API 密钥${NC}"
    else
        echo -e "${RED}✗ 未找到 .env.example 文件${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ .env.local 已存在，跳过创建${NC}"
fi
echo ""

# 显示需要配置的环境变量
echo "================================"
echo "  需要配置的 API 密钥"
echo "================================"
echo ""
echo "1. OpenAI API Key"
echo "   - 访问: https://platform.openai.com/"
echo "   - 变量: OPENAI_API_KEY"
echo ""
echo "2. 高德地图 API Key"
echo "   - 访问: https://lbs.amap.com/"
echo "   - 变量: AMAP_API_KEY"
echo ""
echo -e "${YELLOW}请现在编辑 .env.local 文件，填写这些密钥${NC}"
echo ""

# 询问是否现在编辑
read -p "是否现在打开 .env.local 文件？(y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v code &> /dev/null; then
        code .env.local
    elif command -v nano &> /dev/null; then
        nano .env.local
    elif command -v vi &> /dev/null; then
        vi .env.local
    else
        echo "请手动编辑 .env.local 文件"
    fi
fi

echo ""
echo "================================"
echo "  环境检查"
echo "================================"
echo ""

# 运行环境检查脚本
if [ -f scripts/check-setup.js ]; then
    echo "运行环境检查..."
    node scripts/check-setup.js
else
    echo -e "${YELLOW}⚠ 环境检查脚本不存在，跳过${NC}"
fi

echo ""
echo "================================"
echo "  设置完成！"
echo "================================"
echo ""
echo "下一步操作："
echo ""
echo "1. 确保已配置 .env.local 文件中的 API 密钥"
echo ""
echo "2. 启动开发服务器："
echo "   npm run dev"
echo ""
echo "3. 访问应用："
echo "   http://localhost:3000"
echo ""
echo "4. 运行测试："
echo "   npm test"
echo ""
echo "5. 构建生产版本："
echo "   npm run build"
echo ""
echo "================================"
echo "  有用的命令"
echo "================================"
echo ""
echo "npm run dev          # 启动开发服务器"
echo "npm run build        # 构建生产版本"
echo "npm start            # 启动生产服务器"
echo "npm test             # 运行测试"
echo "npm run lint         # 代码检查"
echo "npm run type-check   # TypeScript 类型检查"
echo ""
echo "查看完整文档: README.md"
echo ""
echo -e "${GREEN}祝您使用愉快！${NC}"
echo ""
