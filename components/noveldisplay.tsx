
import React, { useEffect, useState } from 'react';
import { NovelContent } from '../types.ts';
import { getSafeOpenUrl } from '../utils/urlUtils.ts';

interface NovelDisplayProps {
  novel: NovelContent | null;
  isLoading: boolean;
  onNextChapter?: () => void;
  currentTime?: number; // 當前播放時間（秒）
  duration?: number; // 總時長（秒）
  isPlaying?: boolean; // 是否正在播放
}

const NovelDisplay: React.FC<NovelDisplayProps> = ({ 
  novel, 
  isLoading, 
  onNextChapter,
  currentTime = 0,
  duration = 0,
  isPlaying = false
}) => {
  const [displayKey, setDisplayKey] = useState(0);
  const [iframeError, setIframeError] = useState(false);
  const [viewMode, setViewMode] = useState<'iframe' | 'link' | 'text'>('iframe');
  const [showChapters, setShowChapters] = useState(false);
  
  // 計算當前應該高亮的行
  const getCurrentLineIndex = (): number => {
    if (!novel?.content || !isPlaying || duration === 0) return -1;
    const text = novel.content;
    const allLines = text.split('\n');
    const nonEmptyLines = allLines.map((line, index) => ({ line, originalIndex: index }))
      .filter(({ line }) => line.trim().length > 0);
    
    if (nonEmptyLines.length === 0) return -1;
    
    // 根據播放進度計算當前行
    const progress = Math.min(currentTime / duration, 1);
    const currentLineIndex = Math.floor(progress * nonEmptyLines.length);
    const targetIndex = Math.min(currentLineIndex, nonEmptyLines.length - 1);
    
    // 返回原始行索引（包含空行）
    return nonEmptyLines[targetIndex]?.originalIndex ?? -1;
  };
  
  const currentLineIndex = getCurrentLineIndex();

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
        <div className="flex items-center justify-center gap-4 mb-4">
          <h2 className="text-3xl md:text-5xl font-bold bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent serif-font tracking-tight">
            {novel.title || '小說閱讀'}
          </h2>
          {novel.chapters && novel.chapters.length > 0 && (
            <button
              onClick={() => setShowChapters(!showChapters)}
              className="px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-white text-sm font-bold rounded-xl transition-all"
              title="顯示/隱藏目錄"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        <div className="w-16 h-1 bg-indigo-500/30 mx-auto rounded-full"></div>
      </header>

      {/* 章節目錄 */}
      {showChapters && novel.chapters && novel.chapters.length > 0 && (
        <div className="mb-8 bg-slate-900/60 border border-slate-700/50 rounded-2xl p-6 max-h-[600px] overflow-y-auto">
          <h3 className="text-xl font-bold mb-4 text-slate-200">章節目錄 ({novel.chapters.length} 章)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {novel.chapters.map((chapter, index) => {
              const isCurrentChapter = chapter.url === novel.sourceUrl;
              return (
                <a
                  key={index}
                  href={chapter.url}
                  onClick={(e) => {
                    e.preventDefault();
                    if (onNextChapter && typeof onNextChapter === 'function') {
                      // 如果提供了 onNextChapter 回调，使用它
                      window.location.href = chapter.url;
                    } else {
                      window.location.href = chapter.url;
                    }
                  }}
                  className={`px-4 py-2 rounded-lg text-sm transition-all ${
                    isCurrentChapter
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                  title={chapter.url}
                >
                  <div className="truncate">{chapter.title || `第 ${index + 1} 章`}</div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* 視圖模式切換 */}
      <div className="mb-6 flex justify-center gap-3 flex-wrap">
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
        {novel.content && novel.content.length > 0 && (
          <button
            onClick={() => setViewMode('text')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              viewMode === 'text'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800/70'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline mr-2">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
            </svg>
          文本閱讀
          </button>
        )}
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

      {/* 文本閱讀模式 */}
      {viewMode === 'text' && novel.content && (
        <div className="mb-8">
          <div 
            className="bg-slate-900/60 border border-slate-700/50 rounded-2xl p-8 md:p-12 max-h-[800px] overflow-y-auto"
            id="text-reader-container"
          >
            <div className="prose prose-invert max-w-none leading-relaxed">
              {novel.content.split('\n').map((line, index) => {
                const isCurrentLine = isPlaying && index === currentLineIndex;
                const isEmpty = line.trim().length === 0;
                
                if (isEmpty) {
                  return <div key={index} className="h-4"></div>;
                }
                
                return (
                  <p
                    key={index}
                    id={`line-${index}`}
                    className={`mb-4 transition-all duration-500 ease-in-out ${
                      isCurrentLine
                        ? 'text-2xl md:text-3xl lg:text-4xl font-bold text-indigo-200 bg-indigo-500/30 px-6 py-4 rounded-xl shadow-lg shadow-indigo-500/50 transform scale-[1.05] border-2 border-indigo-400/50'
                        : 'text-base md:text-lg text-slate-300 opacity-80'
                    }`}
                    style={{
                      scrollMarginTop: '150px',
                      transition: 'all 0.5s ease-in-out'
                    }}
                    ref={(el) => {
                      if (isCurrentLine && el) {
                        setTimeout(() => {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                        }, 100);
                      }
                    }}
                  >
                    {line}
                  </p>
                );
              })}
            </div>
          </div>
          {isPlaying && (
            <div className="mt-4 text-center text-xs text-slate-500">
              正在朗讀中... {Math.floor(currentTime)}s / {Math.floor(duration)}s
            </div>
          )}
        </div>
      )}

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

      {/* 上一章和下一章按鈕 */}
      {(novel.prevChapterUrl || novel.nextChapterUrl) ? (
        <div className="mt-8 mb-8 text-center">
          <div className="flex flex-wrap gap-4 justify-center">
            {novel.prevChapterUrl && (
              <button
                onClick={() => {
                  if (novel.prevChapterUrl) {
                    console.log('點擊上一章，跳轉到:', novel.prevChapterUrl);
                    window.location.href = novel.prevChapterUrl;
                  }
                }}
                className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white font-bold rounded-xl shadow-lg shadow-slate-600/30 transition-all hover:scale-105 active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                <span>上一章</span>
              </button>
            )}
            {novel.nextChapterUrl && (
              <button
                onClick={onNextChapter || (() => {
                  if (novel.nextChapterUrl) {
                    console.log('點擊下一章，跳轉到:', novel.nextChapterUrl);
                    window.location.href = novel.nextChapterUrl;
                  }
                })}
                className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 active:scale-95"
              >
                <span>下一章</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            )}
          </div>
          {/* 調試信息 */}
          <div className="mt-2 text-xs text-slate-500">
            {novel.prevChapterUrl && <div>上一章URL: {novel.prevChapterUrl}</div>}
            {novel.nextChapterUrl && <div>下一章URL: {novel.nextChapterUrl}</div>}
          </div>
        </div>
      ) : (
        <div className="mt-8 mb-8 text-center">
          <div className="text-xs text-slate-500">
            未找到章節鏈接（調試信息：prevChapterUrl = {String(novel.prevChapterUrl)}, nextChapterUrl = {String(novel.nextChapterUrl)}）
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
