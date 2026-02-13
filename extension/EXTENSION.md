# 瀏覽器朗讀擴充功能（Simple Web Reader）

這是一個不需要編譯的 WebExtension，注入到網頁後提供頁面內浮動控制列，可朗讀選取內容或主要文章，並可調整語速。

## Chrome / Chromium 安裝
1. 打開 `chrome://extensions`
2. 開啟右上角「開發人員模式」
3. 點「載入未封裝項目」
4. 選擇此專案的 `extension/` 目錄

## Safari 安裝（WebExtension 轉換）
1. 在專案根目錄執行：
   - `xcrun safari-web-extension-converter extension/`
2. 依提示產生 Safari 專案並打開 Xcode
3. 設定 Team / Bundle Identifier
4. 在 Safari 啟用「開發者」並允許擴充功能

## 使用方式
- 有選取文字：朗讀選取內容
- 未選取文字：自動抓取主文（失敗時讀整頁）
- 右下角浮動控制列可播放 / 暫停 / 停止 / 調整語速
