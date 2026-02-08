# 推送代码到 GitHub 指南

## 当前状态
✅ 所有修复已完成
✅ 代码已提交（3个新提交等待推送）
- `efaac4a` 解决合并冲突，保留构建修复
- `4a4e8c8` 修复构建错误并添加 GitHub Actions 部署配置
- `c286334` Update vite.config.ts

## 推送方式

### 方式 1：使用 Personal Access Token（推荐）

1. **创建 Token**：
   - 访问：https://github.com/settings/tokens
   - 点击 "Generate new token (classic)"
   - 勾选 `repo` 权限
   - 复制生成的 token

2. **推送代码**：
   ```bash
   git push origin main
   ```
   - 用户名：`Rong-bit`
   - 密码：粘贴您的 Personal Access Token

### 方式 2：使用 SSH（推荐用于长期使用）

1. **检查是否有 SSH 密钥**：
   ```bash
   ls -la ~/.ssh
   ```

2. **如果没有，生成 SSH 密钥**：
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   # 按 Enter 使用默认路径
   # 可以设置密码或直接按 Enter
   ```

3. **添加 SSH 密钥到 GitHub**：
   ```bash
   cat ~/.ssh/id_ed25519.pub
   # 复制输出内容
   ```
   - 访问：https://github.com/settings/keys
   - 点击 "New SSH key"
   - 粘贴复制的密钥内容
   - 保存

4. **更改远程仓库为 SSH**：
   ```bash
   git remote set-url origin git@github.com:Rong-bit/read.git
   ```

5. **推送**：
   ```bash
   git push origin main
   ```

### 方式 3：使用 GitHub CLI

```bash
# 安装 GitHub CLI（如果还没有）
# macOS: brew install gh
# 或访问：https://cli.github.com/

# 登录
gh auth login

# 推送
git push origin main
```

## 推送后

推送成功后：
1. ✅ 代码会上传到 GitHub
2. ✅ GitHub Actions 会自动运行构建
3. ✅ 如果启用了 GitHub Pages，会自动部署

## 检查推送状态

```bash
# 查看本地和远程的差异
git log origin/main..main

# 如果显示有提交，说明还没有推送
# 如果没有任何输出，说明已经同步
```
