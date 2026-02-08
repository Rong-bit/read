# GitHub 推送指南

## 步骤 1: 初始化 Git 仓库

在终端中执行以下命令：

```bash
cd /Users/joe/Documents/reade
git init
```

## 步骤 2: 添加所有文件

```bash
git add .
```

## 步骤 3: 创建初始提交

```bash
git commit -m "初始提交：小說閱讀器 - 支援 iframe 內嵌和直接跳轉"
```

## 步骤 4: 在 GitHub 创建新仓库

1. 访问 https://github.com/new
2. 填写仓库信息：
   - **Repository name**: `reade` (或您喜欢的名称)
   - **Description**: `小說閱讀器 - 支援 iframe 內嵌和直接跳轉，避免版權問題`
   - **Visibility**: 选择 Public 或 Private
   - **不要**勾选 "Initialize this repository with a README"（我们已经有了）
3. 点击 "Create repository"

## 步骤 5: 连接本地仓库到 GitHub

GitHub 会显示推送命令，类似这样：

```bash
git remote add origin https://github.com/您的用户名/reade.git
git branch -M main
git push -u origin main
```

或者使用 SSH：

```bash
git remote add origin git@github.com:您的用户名/reade.git
git branch -M main
git push -u origin main
```

## 步骤 6: 推送代码

执行推送命令后，输入您的 GitHub 用户名和密码（或使用 Personal Access Token）。

## 完成！

您的代码现在已经推送到 GitHub 了！

---

## 后续更新代码

当您修改代码后，使用以下命令更新 GitHub：

```bash
git add .
git commit -m "描述您的更改"
git push
```
