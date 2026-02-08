# GitHub Pages 部署指南

## 方法一：使用 GitHub Actions 自动部署（推荐）

我们已经创建了自动部署工作流，只需几个步骤即可启用。

### 步骤 1：启用 GitHub Pages

1. 访问您的仓库：https://github.com/Rong-bit/read-app
2. 点击 **Settings**（设置）
3. 在左侧菜单找到 **Pages**
4. 在 **Source** 部分：
   - 选择 **GitHub Actions**
5. 保存设置

### 步骤 2：推送代码

确保所有代码已推送到 GitHub：

```bash
git add .
git commit -m "准备部署"
git push origin main
```

### 步骤 3：查看部署状态

1. 在仓库页面，点击 **Actions** 标签
2. 查看工作流运行状态
3. 部署成功后，会显示部署的 URL

### 步骤 4：访问您的网站

部署完成后，您的网站地址将是：
```
https://rong-bit.github.io/read-app/
```

## 方法二：手动部署（备选方案）

如果 GitHub Actions 不工作，可以使用手动方法：

### 步骤 1：构建项目

```bash
npm run build
```

### 步骤 2：创建 gh-pages 分支

```bash
# 切换到构建输出目录
cd dist

# 初始化 git（如果还没有）
git init
git add .
git commit -m "Deploy to GitHub Pages"

# 创建 gh-pages 分支并推送
git branch -M gh-pages
git remote add origin https://github.com/Rong-bit/read-app.git
git push -u origin gh-pages --force
```

### 步骤 3：配置 GitHub Pages

1. 访问仓库 Settings
2. 找到 Pages 设置
3. Source 选择 **gh-pages** 分支
4. 保存

## 方法三：使用 Vercel（最简单，推荐）

Vercel 提供免费的自动部署，比 GitHub Pages 更简单：

### 步骤 1：访问 Vercel

访问：https://vercel.com

### 步骤 2：导入项目

1. 点击 **Add New Project**
2. 选择 **Import Git Repository**
3. 选择 `Rong-bit/read-app` 仓库
4. 点击 **Import**

### 步骤 3：配置项目

Vercel 会自动检测 Vite 项目，使用默认设置即可：
- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

### 步骤 4：部署

点击 **Deploy**，几分钟后即可访问您的网站。

Vercel 会自动：
- 每次推送代码时自动重新部署
- 提供 HTTPS
- 提供自定义域名
- 提供全球 CDN

## 方法四：使用 Netlify

类似 Vercel，也很简单：

### 步骤 1：访问 Netlify

访问：https://netlify.com

### 步骤 2：连接 GitHub

1. 点击 **Add new site** > **Import an existing project**
2. 选择 **GitHub**
3. 授权并选择 `Rong-bit/read-app` 仓库

### 步骤 3：配置构建设置

- **Build command**: `npm run build`
- **Publish directory**: `dist`

### 步骤 4：部署

点击 **Deploy site**，等待部署完成。

## 当前 GitHub Actions 工作流

我们已经创建了 `.github/workflows/deploy.yml`，它会：

1. ✅ 在每次推送到 `main` 分支时自动运行
2. ✅ 安装依赖
3. ✅ 构建项目
4. ✅ 部署到 GitHub Pages

## 故障排除

### 问题 1：Actions 工作流失败

检查：
- 是否启用了 GitHub Pages（Settings > Pages > Source: GitHub Actions）
- 是否给了正确的权限（工作流中已配置）

### 问题 2：构建失败

检查：
- 所有依赖是否已安装
- `package.json` 中的构建脚本是否正确
- 查看 Actions 日志中的错误信息

### 问题 3：页面显示 404

检查：
- GitHub Pages 是否已启用
- 部署是否成功完成
- 等待几分钟让 DNS 生效

## 自定义域名（可选）

### GitHub Pages

1. 在仓库 Settings > Pages 中添加自定义域名
2. 在您的域名 DNS 中添加 CNAME 记录

### Vercel/Netlify

在项目设置中添加自定义域名，会自动配置 SSL 证书。

## 推荐方案

- **最简单**：Vercel（一键部署，自动 HTTPS）
- **最灵活**：GitHub Actions（完全控制，免费）
- **最快速**：Netlify（类似 Vercel）

选择最适合您的方案即可！
