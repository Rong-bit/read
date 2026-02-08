#!/bin/bash

# 推送代码到 GitHub 的简单脚本

echo "准备推送到 GitHub..."
echo "仓库: https://github.com/Rong-bit/read.git"
echo ""

# 检查是否有未推送的提交
UNPUSHED=$(git log origin/main..main --oneline | wc -l | tr -d ' ')

if [ "$UNPUSHED" -eq 0 ]; then
    echo "✅ 所有提交已推送"
    exit 0
fi

echo "📦 有 $UNPUSHED 个提交等待推送："
git log origin/main..main --oneline
echo ""

# 尝试推送
echo "🚀 开始推送..."
git push origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 推送成功！"
    echo "🌐 查看仓库: https://github.com/Rong-bit/read"
else
    echo ""
    echo "❌ 推送失败，需要身份验证"
    echo ""
    echo "请选择以下方式之一："
    echo "1. 使用 Personal Access Token"
    echo "   - 访问: https://github.com/settings/tokens"
    echo "   - 创建 token 后，推送时使用 token 作为密码"
    echo ""
    echo "2. 使用 SSH"
    echo "   git remote set-url origin git@github.com:Rong-bit/read.git"
    echo "   git push origin main"
    echo ""
    echo "3. 使用 GitHub CLI"
    echo "   gh auth login"
    echo "   git push origin main"
fi
