import React, { useState, useRef, useEffect } from 'react';
import Header from './components/header.tsx';
import Sidebar from './components/sidebar.tsx';
import { NovelContent, ReaderState } from './types.ts';
import { fetchNovelContent, generateSpeech } from './services/geminiService.ts';
// 請確保你的 utils 與其他匯入路徑正確
import { decode, decodeAudioData } from './utils/audioUtils.ts';

const STORAGE_KEY_SETTINGS = 'gemini_reader_settings';
const STORAGE_KEY_PROGRESS = 'gemini_reader_progress';
// ... 其他 STORAGE_KEY 保持不變

/** 小工具函數保持不變 */
function getNovelText(novel: NovelContent | null): string {
  if (!novel) return '';
  if (typeof (novel as any).content === 'string' && (novel as any).content.length > 0) return (novel as any).content;
  const chapters = (novel as any).chapters;
  if (Array.isArray(chapters)) return chapters.map((c: any) => c.text ?? c.content ?? '').join('\n');
  return '';
}

const App: React.FC = () => {
  // --- 保留你所有的原始 States ---
  const [novel, setNovel] = useState<NovelContent | null>(null);
  const [state, setState] = useState<ReaderState>(ReaderState.IDLE);
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<'dark' | 'sepia' | 'slate'>('dark');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // (這裡省略其他 20+ 個 State，請在你的專案中保留它們)

  // --- 保留所有的 Refs ---
  const audioContextRef = useRef<AudioContext | null>(null);
  // ... 其他 Refs 保持不變

  // --- 佈局樣式定義 ---
  const themeStyles = {
    dark: { bg: '#1a1a1a', text: '#e0e0e0', border: 'rgba(255,255,255,0.1)' },
    sepia: { bg: '#f4ecd8', text: '#5b4636', border: 'rgba(0,0,0,0.1)' },
    slate: { bg: '#2d3748', text: '#f7fafc', border: 'rgba(255,255,255,0.1)' },
  };

  // --- 1. 防止二層滾輪的關鍵副作用 ---
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, []);

  // --- 2. 保留你所有的原始 useEffect (初始化、存檔等) ---
  useEffect(() => {
    /* 你的初始化 LocalStorage 邏輯 */
    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      const s = JSON.parse(savedSettings);
      setFontSize(s.fontSize ?? 18);
      setTheme(s.theme || 'dark');
    }
    // ... 其他初始化邏輯
  }, []);

  // --- 3. 整合後的 UI 結構 ---
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',           // 固定視窗高度
      width: '100vw',
      backgroundColor: themeStyles[theme].bg,
      color: themeStyles[theme].text,
      overflow: 'hidden'         // 禁止外層滾動
    }}>
      
      {/* 頂部 Header: 傳入控制側邊欄的 function */}
      <Header onMenuToggle={() => setIsMenuOpen(!isMenuOpen)} />

      <div style={{
        display: 'flex',
        flex: 1,                 // 佔滿 Header 以外的剩餘高度
        overflow: 'hidden'       // 內部容器不滾動
      }}>
        
        {/* 側邊欄 */}
        {isMenuOpen && (
          <aside style={{
            width: '300px',
            borderRight: `1px solid ${themeStyles[theme].border}`,
            overflowY: 'auto'    // 側邊欄清單長度超過時可自行滾動
          }}>
            <Sidebar 
               // 傳入你的 novel 列表與選擇事件
            />
          </aside>
        )}

        {/* 主內容區：唯一的垂直滾動層 */}
        <main style={{
          flex: 1,
          overflowY: 'auto',     // 解決二層滾輪的核心：只讓這裡滾動
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <article style={{
            maxWidth: '800px',
            width: '100%',
            fontSize: `${fontSize}px`,
            lineHeight: '1.8',
            whiteSpace: 'pre-wrap',
            paddingBottom: '100px' // 底部留白避免被控制條遮擋
          }}>
            <h1 style={{ textAlign: 'center', marginBottom: '40px' }}>
              {novel ? (novel as any).title : '歡迎使用 Gemini Reader'}
            </h1>
            
            <div className="novel-body">
              {getNovelText(novel) || "請載入小說內容開始閱讀..."}
            </div>
          </article>
        </main>
      </div>

      {/* 底部播放控制條 (如果有) */}
      <footer style={{
        height: '80px',
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderTop: `1px solid ${themeStyles[theme].border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10
      }}>
         {/* 這裡放置播放、暫停、語速控制按鈕 */}
         <span>狀態: {state}</span>
      </footer>

    </div>
  );
};

export default App;
