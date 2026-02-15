import React, { useState, useRef, useEffect } from 'react';
import Header from './components/header.tsx';
import Sidebar from './components/sidebar.tsx';
// ... 其餘 types 與 services 匯入保持不變

const App: React.FC = () => {
  // --- 狀態管理 (保留你原始的狀態) ---
  const [novel, setNovel] = useState<any | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<'dark' | 'sepia' | 'slate'>('dark');
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  // ... 其他狀態省略

  // --- 佈局樣式變數 ---
  const themeStyles = {
    dark: { bg: '#1a1a1a', text: '#e0e0e0' },
    sepia: { bg: '#f4ecd8', text: '#5b4636' },
    slate: { bg: '#2d3748', text: '#f7fafc' },
  };

  // --- 防止外層捲動 ---
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh', // 鎖定視窗高度
      width: '100vw',
      backgroundColor: themeStyles[theme].bg,
      color: themeStyles[theme].text,
      overflow: 'hidden' // 絕對禁止外層出現滾輪
    }}>
      
      {/* 1. 頂部固定 Header */}
      <Header onMenuToggle={() => setIsMenuOpen(!isMenuOpen)} />

      <div style={{
        display: 'flex',
        flex: 1,           // 自動填滿剩餘高度
        overflow: 'hidden' // 內部佈局容器也不准捲動
      }}>
        
        {/* 2. 側邊欄 (根據狀態顯示) */}
        {isMenuOpen && (
          <aside style={{
            width: '280px',
            borderRight: '1px solid rgba(128,128,128,0.2)',
            overflowY: 'auto' // 側邊欄內容過多時可自行捲動
          }}>
            <Sidebar />
          </aside>
        )}

        {/* 3. 核心內容區 (唯一的滾輪來源) */}
        <main style={{
          flex: 1,
          overflowY: 'auto', // 只有這裡會產生捲軸
          padding: '40px 20px',
          WebkitOverflowScrolling: 'touch', // 優化行動版捲動
          display: 'flex',
          justifyContent: 'center'
        }}>
          <article style={{
            maxWidth: '800px', // 限制閱讀寬度，增加舒適度
            width: '100%',
            fontSize: `${fontSize}px`,
            lineHeight: '1.8',
            whiteSpace: 'pre-wrap', // 保持段落換行
          }}>
            <h1 style={{ marginBottom: '1.5em' }}>
              {novel?.title || '未選擇章節'}
            </h1>
            
            {/* 這裡放入你的主要文本 */}
            <div>
              {getNovelText(novel) || (
                <div style={{ textAlign: 'center', marginTop: '100px', opacity: 0.5 }}>
                  請從側邊欄選擇或搜尋小說內容
                </div>
              )}
            </div>
          </article>
        </main>
      </div>

      {/* 4. 底部播放控制條 (選配) */}
      <div style={{
        height: '60px',
        borderTop: '1px solid rgba(128,128,128,0.2)',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center'
      }}>
        {/* 播放控制按鈕放置處 */}
      </div>
    </div>
  );
};

export default App;
