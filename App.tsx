
import React, { useState, useRef, useEffect } from 'react';
import { NovelContent, ReaderState } from './types.ts';
import { fetchNovelContent, generateSpeech } from './services/geminiService.ts';
import { decode, decodeAudioData } from './utils/audioUtils.ts';
import { getSafeOpenUrl } from './utils/urlUtils.ts';

const STORAGE_KEY_SETTINGS = 'gemini_reader_settings';
const STORAGE_KEY_PROGRESS = 'gemini_reader_progress';
const STORAGE_KEY_WEB_RATE = 'web_reader_rate';
const STORAGE_KEY_WEB_VOICE = 'web_reader_voice';
const STORAGE_KEY_USE_AI_READING = 'gemini_reader_use_ai';

function splitTextForTTS(text: string, maxCharsPerSegment: number = 1200): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const segments: string[] = [];
  const paragraphs = trimmed.split(/\n\n+/);
  for (const p of paragraphs) {
    const block = p.trim();
    if (!block) continue;
    if (block.length <= maxCharsPerSegment) {
      segments.push(block);
    } else {
      for (let i = 0; i < block.length; i += maxCharsPerSegment) {
        segments.push(block.slice(i, i + maxCharsPerSegment));
      }
    }
  }
  return segments.length > 0 ? segments : [trimmed.slice(0, maxCharsPerSegment)];
}

function splitTextForTTSWithRanges(text: string, maxCharsPerSegment: number = 1200): Array<{ text: string; start: number; end: number }> {
  const segments = splitTextForTTS(text, maxCharsPerSegment);
  const ranges: Array<{ text: string; start: number; end: number }> = [];
  let searchFrom = 0;
  for (const segment of segments) {
    const idx = text.indexOf(segment, searchFrom);
    const start = idx >= 0 ? idx : searchFrom;
    const end = Math.min(text.length, start + segment.length);
    ranges.push({ text: segment, start, end });
    searchFrom = end;
  }
  return ranges;
}

type LocalHeaderProps = {
  onToggleMenu: () => void;
};

const Header: React.FC<LocalHeaderProps> = ({ onToggleMenu }) => (
  <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
    <h1 className="text-lg font-bold">Gemini 小說朗讀器</h1>
    <button onClick={onToggleMenu} className="px-3 py-2 rounded-lg bg-slate-800/70 hover:bg-slate-700/70">
      選單
    </button>
  </header>
);

const deriveFallbackTitle = (input: string, content: string): string => {
  const firstNonEmptyLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstNonEmptyLine) return firstNonEmptyLine.slice(0, 40);

  try {
    const u = new URL(input);
    const raw = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    const decoded = decodeURIComponent(raw).replace(/\.(html?|php)$/i, '');
    if (decoded.trim()) return decoded.trim().slice(0, 40);
  } catch {
    // input may be a keyword, not a URL
  }

  const cleaned = input.trim();
  if (cleaned) return cleaned.slice(0, 40);
  return '未命名章節';
};

type LocalSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenBrowse: () => void;
  onOpenLibrary: () => void;
  onNewSearch: () => void;
  onOpenUrlModal?: () => void;
  currentNovelTitle?: string;
  webRate?: number;
  setWebRate?: (v: number) => void;
  webVoice?: string;
  setWebVoice?: (v: string) => void;
  webVoices?: SpeechSynthesisVoice[];
  useAiReading?: boolean;
  setUseAiReading?: (v: boolean) => void;
};

const Sidebar: React.FC<LocalSidebarProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onOpenBrowse,
  onNewSearch,
  onOpenUrlModal,
  currentNovelTitle
}) => (
  <div className={`fixed top-0 right-0 h-full w-[300px] bg-slate-900 border-l border-white/10 z-[160] transition-transform duration-500 ease-out shadow-2xl flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
    <div className="p-4 border-b border-white/10 flex items-center justify-between">
      <span className="font-bold">選單</span>
      <button onClick={onClose}>關閉</button>
    </div>
    <div className="p-4 space-y-2">
      {currentNovelTitle ? <div className="text-sm text-slate-300 truncate">{currentNovelTitle}</div> : null}
      <button className="w-full text-left p-2 bg-slate-800 rounded" onClick={() => { onNewSearch(); onClose(); }}>新搜尋</button>
      <button className="w-full text-left p-2 bg-slate-800 rounded" onClick={() => { onOpenUrlModal?.(); onClose(); }}>網址抓取</button>
      <button className="w-full text-left p-2 bg-slate-800 rounded" onClick={() => { onOpenBrowse(); onClose(); }}>瀏覽書源</button>
      <button className="w-full text-left p-2 bg-slate-800 rounded" onClick={() => { onOpenSettings(); onClose(); }}>閱讀偏好</button>
    </div>
  </div>
);

const App: React.FC = () => {
  const [novel, setNovel] = useState<NovelContent | null>(null);
  const [voice, setVoice] = useState('Kore');
  const [volume, setVolume] = useState(0.8);
  const [playbackRate, setPlaybackRate] = useState(0.8);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(true);
  const [fontSize, setFontSize] = useState(20);
  const [theme, setTheme] = useState<'dark' | 'sepia' | 'slate'>('dark');
  const [showResumeToast, setShowResumeToast] = useState(false);

  const [webUrl, setWebUrl] = useState('');
  const [webTitle, setWebTitle] = useState('');
  const [webText, setWebText] = useState('');
  const [webRate, setWebRate] = useState(0.8);
  const [webError, setWebError] = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(false);
  const [webIsSpeaking, setWebIsSpeaking] = useState(false);
  const [webIsPaused, setWebIsPaused] = useState(false);
  const [webVoices, setWebVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [webVoice, setWebVoice] = useState('');
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [useAiReading, setUseAiReading] = useState(false);
  const [webAiLoading, setWebAiLoading] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const webAiPlayingRef = useRef(false);
  const webTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const boundaryTickRef = useRef<number | null>(null);
  const ttsStartAtRef = useRef<number>(0);
  const [readingCharIndex, setReadingCharIndex] = useState<number | null>(null);

  const syncReadingPosition = (charIndex: number | null) => {
    const textarea = webTextareaRef.current;
    if (!textarea || charIndex === null) return;
    const clamped = Math.max(0, Math.min(charIndex, textarea.value.length));
    const lineNumber = textarea.value.slice(0, clamped).split('\n').length;
    const computed = window.getComputedStyle(textarea);
    const parsedLineHeight = parseFloat(computed.lineHeight || '');
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 2.2;
    const targetTop = Math.max(0, (lineNumber - 4) * lineHeight);
    textarea.setSelectionRange(clamped, clamped);
    const absoluteTop = textarea.getBoundingClientRect().top + window.scrollY + targetTop;
    window.scrollTo({ top: Math.max(0, absoluteTop - 120), behavior: 'smooth' });
  };

  useEffect(() => {
    syncReadingPosition(readingCharIndex);
  }, [readingCharIndex, fontSize]);

  useEffect(() => {
    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      const s = JSON.parse(savedSettings);
      setVoice(s.voice || 'Kore');
      setVolume(s.volume ?? 0.8);
      setPlaybackRate(s.playbackRate ?? 0.8);
      setFontSize(s.fontSize ?? 20);
      setTheme(s.theme || 'dark');
    }
    const savedWebRate = localStorage.getItem(STORAGE_KEY_WEB_RATE);
    if (savedWebRate) setWebRate(parseFloat(savedWebRate));
    const savedUseAi = localStorage.getItem(STORAGE_KEY_USE_AI_READING);
    if (savedUseAi === 'true') setUseAiReading(true);

    const loadVoices = () => setWebVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const handleSearch = async (input: string) => {
    try {
      handleWebStop();
      setWebLoading(true);
      setWebError(null);
      const data = await fetchNovelContent(input);
      const resolvedTitle = data.title?.trim() || deriveFallbackTitle(input, data.content || '');
      setNovel({ ...data, title: resolvedTitle });
      setWebTitle(resolvedTitle);
      setWebText(data.content);
      setShowSearch(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setWebError(err.message || "載入失敗。");
    } finally {
      setWebLoading(false);
    }
  };

  const handleWebPlayPause = async () => {
    const text = webText.trim();
    if (!text) return;
    if (webAiPlayingRef.current && audioContextRef.current) {
      if (!webIsPaused) { await audioContextRef.current.suspend(); setWebIsPaused(true); }
      else { await audioContextRef.current.resume(); setWebIsPaused(false); }
      return;
    }
    if (window.speechSynthesis.speaking && !webAiPlayingRef.current) {
      if (window.speechSynthesis.paused) { window.speechSynthesis.resume(); setWebIsPaused(false); }
      else { window.speechSynthesis.pause(); setWebIsPaused(true); }
      return;
    }
    if (useAiReading) {
      handleWebStop();
      const segments = splitTextForTTSWithRanges(text, 1200);
      setWebAiLoading(true);
      const ctx = initAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      webAiPlayingRef.current = true;
      const playNextSegment = async (index: number) => {
        if (!webAiPlayingRef.current || index >= segments.length) { handleWebStop(); return; }
        try {
          const currentSegment = segments[index];
          setReadingCharIndex(currentSegment.start);
          const base64Audio = await generateSpeech(currentSegment.text, 'Kore');
          const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.onended = () => { if (webAiPlayingRef.current) playNextSegment(index + 1); };
          source.start(0);
          sourceRef.current = source;
          setWebIsSpeaking(true); setWebIsPaused(false); setWebAiLoading(false);
        } catch (e) { setWebError("AI 朗讀出錯。"); handleWebStop(); }
      };
      playNextSegment(0);
    } else {
      handleWebStop();
      const utterance = new SpeechSynthesisUtterance(text);
      if (webVoice) { const selectedVoice = webVoices.find(v => v.name === webVoice); if (selectedVoice) utterance.voice = selectedVoice; }
      utterance.rate = webRate;
      utterance.onstart = () => {
        setWebIsSpeaking(true);
        setWebIsPaused(false);
        setReadingCharIndex(0);
        ttsStartAtRef.current = Date.now();
        if (boundaryTickRef.current) window.clearInterval(boundaryTickRef.current);
        // 部分瀏覽器/語音不會穩定觸發 onboundary，使用時間估算做備援同步。
        boundaryTickRef.current = window.setInterval(() => {
          if (!window.speechSynthesis.speaking || window.speechSynthesis.paused) return;
          const elapsedSec = (Date.now() - ttsStartAtRef.current) / 1000;
          const charsPerSec = Math.max(4, 8 * webRate);
          const estimatedIndex = Math.floor(elapsedSec * charsPerSec);
          setReadingCharIndex((prev) => {
            const next = Math.min(text.length, estimatedIndex);
            if (prev === null) return next;
            return Math.max(prev, next);
          });
        }, 180);
      };
      utterance.onboundary = (event: SpeechSynthesisEvent) => {
        if (typeof event.charIndex === 'number') setReadingCharIndex(event.charIndex);
      };
      utterance.onend = () => {
        if (boundaryTickRef.current) { window.clearInterval(boundaryTickRef.current); boundaryTickRef.current = null; }
        setWebIsSpeaking(false);
        setWebIsPaused(false);
        setReadingCharIndex(null);
      };
      utterance.onerror = () => handleWebStop();
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleWebStop = () => {
    if (webAiPlayingRef.current) { webAiPlayingRef.current = false; try { sourceRef.current?.stop(); } catch {} sourceRef.current = null; }
    if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
    if (boundaryTickRef.current) { window.clearInterval(boundaryTickRef.current); boundaryTickRef.current = null; }
    setWebIsSpeaking(false); setWebIsPaused(false); setWebAiLoading(false);
    setReadingCharIndex(null);
  };

  const getThemeClass = () => {
    switch(theme) {
      case 'sepia': return 'bg-[#f4ecd8] text-[#433422] selection:bg-[#5b4636]/20';
      case 'slate': return 'bg-[#1e293b] text-slate-200 selection:bg-indigo-500/30';
      default: return 'bg-[#0b0f1a] text-slate-300 selection:bg-indigo-500/30';
    }
  };

  // 根據主題回傳標題樣式
  const getTitleClass = () => {
    switch(theme) {
      case 'sepia': return 'text-[#433422] font-bold'; // 羊皮紙模式下使用深褐色實色
      case 'slate': return 'text-slate-100 font-bold';
      default: return 'bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent'; // 預設深色模式使用漸層
    }
  };

  const getDividerClass = () => {
    switch(theme) {
      case 'sepia': return 'bg-[#5b4636]/20';
      default: return 'bg-indigo-500/30';
    }
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-500 ${getThemeClass()}`}>
      <Header onToggleMenu={() => setIsMenuOpen(true)} />
      
      <Sidebar 
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenBrowse={() => setIsBrowseOpen(true)}
        onOpenLibrary={() => setIsBrowseOpen(true)}
        onNewSearch={() => setShowSearch(true)}
        onOpenUrlModal={() => { setWebUrl(''); setIsUrlModalOpen(true); setIsMenuOpen(false); }}
        currentNovelTitle={novel?.title ?? webTitle}
        webRate={webRate}
        setWebRate={setWebRate}
        webVoice={webVoice}
        setWebVoice={setWebVoice}
        webVoices={webVoices}
        useAiReading={useAiReading}
        setUseAiReading={setUseAiReading}
      />

      <main className="flex-1 w-full px-4 md:px-12 lg:px-24">
        <div className="max-w-7xl mx-auto pt-8 md:pt-12">
          <div className="space-y-8 pb-48">
            {(webTitle || novel?.title) && (
              <header className="mb-10 text-center animate-fade-in-up">
                <h2 className={`text-4xl md:text-6xl serif-font tracking-tight mb-4 ${getTitleClass()}`}>
                  {webTitle || novel?.title}
                </h2>
                <div className={`w-24 h-1 mx-auto rounded-full ${getDividerClass()}`}></div>
              </header>
            )}

            {webError && (
              <div className="p-4 bg-red-900/20 text-red-400 rounded-2xl border border-red-500/20 text-center animate-fade-in-up">
                {webError}
              </div>
            )}
            
            <textarea
              ref={webTextareaRef}
              value={webText}
              onChange={(e) => setWebText(e.target.value)}
              placeholder="在此貼上小說內容，或從側邊欄使用「網址抓取」..."
              style={{ 
                fontSize: `${fontSize}px`,
                fieldSizing: 'content' as any 
              }}
              className={`w-full bg-transparent border-0 focus:ring-0 leading-[2.2] resize-none overflow-y-auto serif-font min-h-screen ${theme === 'sepia' ? 'placeholder:text-[#5b4636]/30' : 'placeholder:opacity-30'}`}
            />
          </div>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-6 z-[100] bg-gradient-to-t from-black/80 via-black/40 to-transparent backdrop-blur-sm pointer-events-none">
        <div className="max-w-md mx-auto flex justify-center items-center gap-6 pointer-events-auto">
          <button onClick={() => novel?.prevChapterUrl && handleSearch(novel.prevChapterUrl)} disabled={!novel?.prevChapterUrl} className="p-4 bg-slate-900/80 border border-white/5 rounded-full disabled:opacity-30 hover:bg-slate-800 transition-all shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button onClick={handleWebPlayPause} className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-2xl hover:scale-105 active:scale-95 transition-all">
            {webAiLoading ? <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin"></div> : (webIsSpeaking && !webIsPaused ? <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><path d="m7 4 12 8-12 8V4z"/></svg>)}
          </button>
          <button onClick={handleWebStop} className="p-4 bg-slate-900/80 border border-white/5 rounded-full hover:bg-slate-800 transition-all shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>
          </button>
          <button onClick={() => novel?.nextChapterUrl && handleSearch(novel.nextChapterUrl)} disabled={!novel?.nextChapterUrl} className="p-4 bg-slate-900/80 border border-white/5 rounded-full disabled:opacity-30 hover:bg-slate-800 transition-all shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-[2rem] p-8 shadow-2xl text-slate-100 animate-fade-in-up">
            <div className="flex justify-between items-center mb-8"><h2 className="text-2xl font-bold">閱讀偏好</h2><button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>
            <div className="space-y-8">
              <div><label className="block text-sm font-bold text-slate-400 mb-3 uppercase tracking-widest">字體大小 ({fontSize}px)</label><input type="range" min="14" max="32" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" /></div>
              <div><label className="block text-sm font-bold text-slate-400 mb-4 uppercase tracking-widest">閱讀主題</label><div className="grid grid-cols-3 gap-3">{['dark', 'sepia', 'slate'].map(t => (<button key={t} onClick={() => {setTheme(t as any); setIsSettingsOpen(false);}} className={`py-4 rounded-2xl border transition-all font-bold ${theme === t ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-white/5 bg-white/5 text-slate-500'}`}>{t === 'dark' ? '深邃黑' : t === 'sepia' ? '羊皮紙' : '岩板灰'}</button>))}</div></div>
            </div>
          </div>
        </div>
      )}

      {isUrlModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl text-slate-100 animate-fade-in-up">
            <h2 className="text-2xl font-bold mb-6 text-center">開始閱讀</h2>
            <div className="space-y-4">
              <input value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="輸入小說網址或書名關鍵字..." className="w-full bg-slate-800 border border-white/5 p-5 rounded-2xl outline-none" />
              <button onClick={() => { handleSearch(webUrl); setIsUrlModalOpen(false); }} disabled={webLoading} className="w-full py-5 bg-indigo-600 rounded-2xl font-bold text-lg">{webLoading ? '解析中...' : '立即解析'}</button>
              <button onClick={() => setIsUrlModalOpen(false)} className="w-full mt-2 text-slate-400">取消</button>
            </div>
          </div>
        </div>
      )}

      {isBrowseOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl text-slate-100 animate-fade-in-up">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold">瀏覽書源</h2>
                <p className="text-slate-400 text-sm mt-1">開啟連結搜尋後，將網址貼回首頁進行抓取。</p>
              </div>
              <button onClick={() => setIsBrowseOpen(false)} className="text-slate-400 hover:text-white">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { name: '番茄小說', url: 'https://fanqienovel.com/', c: 'bg-orange-500' },
                { name: '起點中文網', url: 'https://www.qidian.com/', c: 'bg-red-600' },
                { name: '晉江文學城', url: 'https://www.jjwxc.net/', c: 'bg-green-600' },
                { name: '縱橫中文網', url: 'https://www.zongheng.com/', c: 'bg-blue-600' }
              ].map(site => (
                <a key={site.name} href={site.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all group">
                  <div className={`w-12 h-12 rounded-xl ${site.c} flex items-center justify-center text-white font-bold shadow-lg`}>{site.name[0]}</div>
                  <div>
                    <h3 className="font-bold group-hover:text-indigo-400 transition-colors">{site.name}</h3>
                    <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">前往官方網站</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
