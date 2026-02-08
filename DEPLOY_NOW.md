# 立即部署（不需先 push 到 GitHub）

專案已建置完成（`dist/`），可用以下任一方式上線。

---

## 方式一：Vercel CLI（本機一鍵部署）

### 1. 修正 npm 權限（只需做一次）

在 **Terminal.app** 或 **iTerm** 執行：

```bash
sudo chown -R $(whoami) ~/.npm
```

輸入 Mac 登入密碼後完成。

### 2. 部署

在專案目錄執行：

```bash
cd /Users/joe/Documents/reade
npx vercel
```

- 第一次會要你登入 Vercel（用 GitHub 登入即可）
- 問到設定時直接按 Enter 用預設即可
- 完成後會給一個網址，例如：`https://read-app-xxx.vercel.app`

之後要更新網站，同樣執行：

```bash
npm run build
npx vercel --prod
```

---

## 方式二：Vercel 網頁（用 GitHub 連線）

若你之後能成功把程式推到 GitHub（例如用 SSH 或 Token），可以：

1. 打開 https://vercel.com → 用 GitHub 登入
2. **Add New** → **Project** → 選擇 **Rong-bit/read-app**
3. 不用改設定，直接 **Deploy**
4. 之後每次 push 到 `main` 都會自動重新部署

**部署後的網址**：Vercel 會依專案名稱產生，例如：
- `https://read-app.vercel.app`（專案 **rong-bit/read-app** 的預設網址）
- 或 `https://read-app-你的帳號.vercel.app`（若名稱有衝突）

部署完成後在專案頁面的 **Domains** 可看到實際網址，也可在設定中綁定自己的網域。

---

## 方式三：Netlify 網頁

1. 打開 https://app.netlify.com → 用 GitHub 登入
2. **Add new site** → **Import an existing project** → 選 **GitHub** → 選 **Rong-bit/read-app**
3. Build command: `npm run build`，Publish directory: `dist`
4. **Deploy**

---

**建議**：先做方式一的 1、2，馬上就能拿到一個可用的線上網址。
