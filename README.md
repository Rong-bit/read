<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 小說閱讀器

一款小說閱讀輔助工具，提供 iframe 內嵌和直接跳轉兩種方式訪問小說網站，避免版權問題。

## 功能特色

- 🔗 **連結導向**：支援輸入小說網址，提供內嵌和跳轉兩種查看方式
- 🖼️ **Iframe 內嵌**：在應用內直接顯示小說網站（如果網站允許）
- 🚀 **直接跳轉**：一鍵在新視窗開啟官方網站
- 🎨 **多種閱讀主題**：深邃黑、羊皮紙、岩板灰
- ⚖️ **版權友好**：不抓取、不儲存任何內容，僅提供連結導向功能

## 本地運行

**前置需求：** Node.js 18+

### 1. 安裝依賴

```bash
# 安裝前端和後端依賴
npm run install:all
```

或分別安裝：

```bash
# 前端依賴
npm install

# 後端依賴
cd server && npm install
```

### 2. 配置環境變數（可選）

如果需要使用 TTS 語音合成功能，在專案根目錄創建 `.env.local` 文件：

```env
# Gemini API Key（用於 TTS 語音合成，可選）
GEMINI_API_KEY=your_gemini_api_key_here
```

**注意**：當前版本主要提供連結導向功能，TTS 功能已禁用。

### 3. 啟動服務

**方式一：同時啟動前後端（推薦）**

```bash
npm run dev:all
```

**方式二：分別啟動**

```bash
# 終端 1：啟動前端（端口 3000）
npm run dev

# 終端 2：啟動後端（端口 3001）
npm run dev:server
```

### 4. 訪問應用

打開瀏覽器訪問：http://localhost:3000

## 使用說明

1. 在輸入框貼上小說網址（如番茄小說、起點中文網等）
2. 點擊「開啟閱讀」按鈕
3. 選擇查看方式：
   - **內嵌閱讀**：在應用內通過 iframe 顯示（如果網站允許）
   - **直接跳轉**：在新視窗開啟官方網站
4. 如果 iframe 無法載入，系統會自動提示切換為直接跳轉

## 技術架構

- **前端**：React 19 + TypeScript + Vite
- **後端**：Node.js + Express（可選，當前版本不需要）
- **部署**：純前端應用，可部署到 Vercel、Netlify 等平台

## 支援的小說網站

支援任何提供公開閱讀頁面的小說網站，包括但不限於：

- 番茄小說 (fanqienovel.com)
- 起點中文網 (qidian.com)
- 晉江文學城 (jjwxc.net)
- 縱橫中文網 (zongheng.com)
- 其他小說閱讀網站

## 版權聲明

本應用僅作為閱讀輔助工具，提供連結導向功能。所有內容均來自對應的官方網站。
本應用不儲存、不複製、不傳播任何受版權保護的內容。內容的版權歸原作者及發佈平台所有。
請支持正版，前往官方網站閱讀完整內容。

## 部署到 GitHub Pages

1. 構建專案：`npm run build`
2. 將 `dist` 目錄推送到 GitHub
3. 在 GitHub 倉庫設置中啟用 GitHub Pages
4. 選擇 `dist` 目錄作為源

或使用 Vercel/Netlify 等平台自動部署。
