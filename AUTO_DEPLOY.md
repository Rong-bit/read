# 🚀 GitHub Pages 自动部署指南

## ✅ 已完成的配置

您的项目已经配置好自动部署！只需要两个步骤：

## 📋 步骤 1：启用 GitHub Pages

1. **访问仓库设置**：
   - 打开：https://github.com/Rong-bit/read/settings/pages

2. **配置 Pages**：
   - 在 **Source** 部分
   - 选择：**GitHub Actions**（不是分支！）
   - 点击 **Save**

## 📋 步骤 2：推送代码

推送代码后，GitHub Actions 会自动：
- ✅ 检测代码推送
- ✅ 安装依赖
- ✅ 构建项目
- ✅ 部署到 GitHub Pages

```bash
git push origin main
```

## 🎉 完成！

推送后，访问 **Actions** 标签查看部署进度：
https://github.com/Rong-bit/read/actions

部署完成后，您的网站将在：
```
https://rong-bit.github.io/read/
```

## 📊 查看部署状态

1. 访问：https://github.com/Rong-bit/read/actions
2. 点击最新的工作流运行
3. 查看构建和部署日志

## ⚙️ 自动部署触发条件

每次以下情况会自动部署：
- ✅ 推送到 `main` 分支
- ✅ 手动触发（在 Actions 页面点击 "Run workflow"）

## 🔧 如果部署失败

1. **检查 Actions 日志**：查看错误信息
2. **确认 Pages 已启用**：Settings > Pages > Source: GitHub Actions
3. **检查权限**：确保仓库有 Pages 写入权限（通常自动配置）

## 📝 注意事项

- 首次部署可能需要几分钟
- 部署后可能需要等待 1-2 分钟让 DNS 生效
- 每次推送代码都会自动重新部署

---

**现在只需要推送代码，一切都会自动完成！** 🎊
