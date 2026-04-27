
import React, { useEffect, useState } from 'react';
import { NovelContent } from '../types.ts';
import { getSafeOpenUrl } from '../utils/urlUtils.ts';

interface NovelDisplayProps {
  novel: NovelContent | null;
  isLoading: boolean;
  onNextChapter?: () => void;
}

const NovelDisplay: React.FC<NovelDisplayProps> = ({ novel, isLoading, onNextChapter }) => {
  const [displayKey, setDisplayKey] = useState(0);
  const [iframeError, setIframeError] = useState(false);
  const [viewMode, setViewMode] = useState<'iframe' | 'link'>('iframe');

  // Trigger animation whenever novel content changes
  useEffect(() => {
    if (novel) {
      setDisplayKey(prev => prev + 1);
      setIframeError(false);
      setViewMode('iframe');
    }
  }, [novel?.sourceUrl]);

  if (isLoading) {
    return (
      <div className="w-full max-w-6xl mx-auto mt-6 animate-pulse space-y-8">
        <div className="h-10 bg-slate-800/50 rounded-xl w-2/3 mx-auto"></div>
        <div className="h-96 bg-slate-800/40 rounded-2xl"></div>
      </div>
    );
  }

  if (!novel || !novel.sourceUrl) return null;

  const safeUrl = getSafeOpenUrl(novel.sourceUrl);
  const hasValidUrl = !!safeUrl;

  const handleIframeError = () => {
    setIframeError(true);
    setViewMode('link');
  };

  return (
    <div 
      key={displayKey}
      className="w-full max-w-6xl mx-auto mt-6 pb-40 animate-fade-in-up"
    >
      <header className="mb-8 text-center">
        <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent serif-font tracking-tight">
          {novel.title || '小說閱讀'}
        </h2>
        <div className="w-16 h-1 bg-indigo-500/30 mx-auto rounded-full"></div>
      </header>

      {/* 視圖模式切換 */}
      <div className="mb-6 flex justify-center gap-3">
        <button
          onClick={() => setViewMode('iframe')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            viewMode === 'iframe'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800/70'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline mr-2">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <path d="M3 9h18"/>
            <path d="M9 21V9"/>
          </svg>
          內嵌閱讀
        </button>
        <button
          onClick={() => setViewMode('link')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            viewMode === 'link'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800/70'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline mr-2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          直接跳轉
        </button>
      </div>

      {/* Iframe 嵌入模式：僅在網址有效時嵌入，避免 Safari 顯示「網址無效」 */}
      {viewMode === 'iframe' && !iframeError && hasValidUrl && (
        <div className="mb-8">
          <div className="relative w-full h-[600px] md:h-[800px] rounded-2xl overflow-hidden border border-slate-700/50 bg-slate-900/50 shadow-2xl">
            <iframe
              src={safeUrl!}
              className="w-full h-full"
              title={novel.title || '小說閱讀'}
              onError={handleIframeError}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              allow="fullscreen"
            />
            {iframeError && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90">
                <div className="text-center p-8">
                  <p className="text-slate-400 mb-4">無法載入內嵌頁面</p>
                  <button
                    onClick={() => setViewMode('link')}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all"
                  >
                    切換為直接跳轉
                  </button>
                </div>
              </div>
            )}
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">
            提示：如果無法顯示內容，請點擊上方「直接跳轉」按鈕
          </p>
        </div>
      )}
      {viewMode === 'iframe' && !iframeError && !hasValidUrl && (
        <div className="mb-8 p-8 bg-amber-900/20 border border-amber-500/30 rounded-2xl text-center">
          <p className="text-amber-400 mb-4">網址無效，無法內嵌。請使用「直接跳轉」或重新輸入正確網址。</p>
          <button
            onClick={() => setViewMode('link')}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold"
          >
            切換為直接跳轉
          </button>
        </div>
      )}

      {/* 直接跳轉模式 */}
      {viewMode === 'link' && (
        <div className="mb-8">
          <div className="p-12 bg-slate-900/40 rounded-2xl border border-slate-800/50 backdrop-blur-sm text-center">
            <div className="mb-8">
              <div className="w-20 h-20 mx-auto mb-6 bg-indigo-600/20 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">前往官方網站閱讀</h3>
              <p className="text-slate-400 text-sm mb-6">點擊下方按鈕在新視窗開啟</p>
            </div>
            
            <a
              href={safeUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 active:scale-95"
              onClick={e => { if (!safeUrl) e.preventDefault(); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17 17 7M7 7h10v10"/>
              </svg>
              開啟閱讀頁面
            </a>
            
            <div className="mt-6 p-4 bg-slate-800/30 rounded-xl">
              <p className="text-xs text-slate-500 font-mono break-all">{novel.sourceUrl}</p>
            </div>
          </div>
        </div>
      )}

      {/* 版權聲明 */}
      <footer className="mt-12 p-6 bg-slate-900/40 rounded-2xl border border-slate-800/50 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1.5 h-6 bg-indigo-500 rounded-full"></div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">版權聲明</h4>
        </div>
        
        <div className="p-4 bg-amber-900/20 border border-amber-500/20 rounded-xl">
          <p className="text-xs text-amber-400/80 leading-relaxed">
            <strong className="text-amber-300">免責聲明：</strong>
            本應用僅作為閱讀輔助工具，提供連結導向功能。所有內容均來自對應的官方網站。
            本應用不儲存、不複製、不傳播任何受版權保護的內容。內容的版權歸原作者及發佈平台所有。
            請支持正版，前往官方網站閱讀完整內容。
          </p>
        </div>
      </footer>
    </div>
  );
};

export default NovelDisplay;
