
import React, { useState, useRef, useEffect } from 'react';
import Header from './components/header.tsx';
import Sidebar from './components/sidebar.tsx';
import NovelInput from './components/novelinput.tsx';
import NovelDisplay from './components/noveldisplay.tsx';
import { NovelContent, ReaderState } from './types.ts';
import { fetchNovelContent, generateSpeech } from './services/geminiService.ts';
import { decode, decodeAudioData } from './utils/audioUtils.ts';
import { getSafeOpenUrl } from './utils/urlUtils.ts';

const STORAGE_KEY_SETTINGS = 'gemini_reader_settings';
const STORAGE_KEY_PROGRESS = 'gemini_reader_progress';
const STORAGE_KEY_WEB_RATE = 'web_reader_rate';
const STORAGE_KEY_WEB_VOICE = 'web_reader_voice';
const STORAGE_KEY_WEB_LIST = 'web_reader_list';

function getNovelText(novel: NovelContent | null): string {
  if (!novel) return '';
  if (typeof (novel as any).content === 'string' && (novel as any).content.length > 0) return (novel as any).content;
  const chapters = (novel as any).chapters;
  if (Array.isArray(chapters)) return chapters.map((c: any) => c.text ?? c.content ?? '').join('\n');
  return '';
}

const App: React.FC = () => {
  // --- States ---
  const [novel, setNovel] = useState<NovelContent | null>(null);
  const [state, setState] = useState<ReaderState>(ReaderState.IDLE);
  const [voice, setVoice] = useState('Kore');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(true);
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<'dark' | 'sepia' | 'slate'>('dark');
  const [showResumeToast, setShowResumeToast] = useState(false);
  const [readerMode, setReaderMode] = useState<'novel' | 'web'>('novel');

  const [webUrl, setWebUrl] = useState('');
  const [webTitle, setWebTitle] = useState('');
  const [webText, setWebText] = useState('');
  const [webRate, setWebRate] = useState(1.0);
  const [webError, setWebError] = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(false);
  const [webIsSpeaking, setWebIsSpeaking] = useState(false);
  const [webIsPaused, setWebIsPaused] = useState(false);
  const [webVoices, setWebVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [webVoice, setWebVoice] = useState('');
  const [webList, setWebList] = useState<Array<{ id: string; title: string; text: string }>>([]);
  const [showShareHelp, setShowShareHelp] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  // --- Refs ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const requestRef = useRef<number>(0);
  const lastSavedTimeRef = useRef<number>(0);
  const webUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // --- Initialization ---
  useEffect(() => {
    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      const s = JSON.parse(savedSettings);
      setVoice(s.voice || 'Kore');
      setVolume(s.volume ?? 0.8);
      setPlaybackRate(s.playbackRate ?? 1.0);
      setFontSize(s.fontSize ?? 18);
      setTheme(s.theme || 'dark');
    }

    const savedWebRate = localStorage.getItem(STORAGE_KEY_WEB_RATE);
    if (savedWebRate) {
      const rate = parseFloat(savedWebRate);
      if (!Number.isNaN(rate)) setWebRate(rate);
    }

    const savedWebVoice = localStorage.getItem(STORAGE_KEY_WEB_VOICE);
    if (savedWebVoice) setWebVoice(savedWebVoice);

    const savedWebList = localStorage.getItem(STORAGE_KEY_WEB_LIST);
    if (savedWebList) {
      try {
        const list = JSON.parse(savedWebList);
        if (Array.isArray(list)) setWebList(list);
      } catch {}
    }

    const savedProgress = localStorage.getItem(STORAGE_KEY_PROGRESS);
    if (savedProgress) {
      const p = JSON.parse(savedProgress);
      if (p.novel) {
        setNovel(p.novel);
        setCurrentTime(p.currentTime || 0);
        setShowSearch(false); // 如果有紀錄，預設進入閱讀模式
        setShowResumeToast(true);
        setTimeout(() => setShowResumeToast(false), 3000);
      }
    }
  }, []);

  useEffect(() => {
    const settings = { voice, volume, playbackRate, fontSize, theme };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  }, [voice, volume, playbackRate, fontSize, theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WEB_RATE, String(webRate));
  }, [webRate]);

  useEffect(() => {
    if (webVoice) localStorage.setItem(STORAGE_KEY_WEB_VOICE, webVoice);
  }, [webVoice]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WEB_LIST, JSON.stringify(webList));
  }, [webList]);

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  const saveReadingProgress = (time: number) => {
    if (!novel) return;
    const progress = { novel, currentTime: time };
    localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progress));
    lastSavedTimeRef.current = time;
  };

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const updateProgress = () => {
    if (audioContextRef.current && state === ReaderState.PLAYING) {
      const elapsedSinceStart = audioContextRef.current.currentTime - startTimeRef.current;
      const newTime = Math.min(lastSavedTimeRef.current + (elapsedSinceStart * playbackRate), duration);
      setCurrentTime(newTime);
      
      if (Math.floor(newTime) % 5 === 0 && Math.abs(newTime - lastSavedTimeRef.current) > 1) {
        const progress = { novel, currentTime: newTime };
        localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progress));
      }
    }
    requestRef.current = requestAnimationFrame(updateProgress);
  };

  useEffect(() => {
    if (state === ReaderState.PLAYING) {
      requestRef.current = requestAnimationFrame(updateProgress);
    } else {
      cancelAnimationFrame(requestRef.current);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [state, duration, playbackRate]);

  useEffect(() => {
    if (readerMode !== 'web') {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      setWebIsSpeaking(false);
      setWebIsPaused(false);
      webUtteranceRef.current = null;
    }
  }, [readerMode]);

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setWebVoices(voices);
      if (!webVoice && voices.length > 0) {
        const zhVoice = voices.find(v => v.lang?.toLowerCase().startsWith('zh'));
        setWebVoice((zhVoice || voices[0]).name);
      }
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      speechSynthesis.onvoiceschanged = null;
    };
  }, [webVoice]);

  const handleSearch = async (input: string) => {
    try {
      handleStop();
      setState(ReaderState.FETCHING);
      setError(null);
      const data = await fetchNovelContent(input);
      setNovel(data);
      saveReadingProgress(0);
      setShowSearch(false); // 成功載入後隱藏搜尋區域
      setState(ReaderState.IDLE);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "無法處理網址。請檢查網址是否正確。");
      setState(ReaderState.ERROR);
    }
  };

  const handleNextChapter = () => {
    // 不再支持下一章功能，因為不抓取內容
    const url = novel?.sourceUrl ? getSafeOpenUrl(novel.sourceUrl) : null;
    if (url) window.open(url, '_blank');
  };

  const playAudio = async () => {
    const text = getNovelText(novel);
    if (!novel) {
      setError('請先輸入小說網址並載入內容');
      return;
    }
    if (!text || text.length === 0) {
      setError('此環境無法取得章節正文。若要朗讀請在本機執行 npm run dev:all，並從同一網址重新載入。');
      return;
    }
    try {
      setState(ReaderState.READING);
      setError(null);
      const resumeFrom = currentTime;
      const ctx = initAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      if (sourceRef.current) sourceRef.current.stop();

      const textToRead = text.slice(0, 4000);
      const base64Audio = await generateSpeech(textToRead, voice);
      const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
      setDuration(audioBuffer.duration);

      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      gainNodeRef.current = gainNode;
      source.buffer = audioBuffer;
      source.playbackRate.value = playbackRate;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      source.onended = () => {
        setState(ReaderState.IDLE);
        setCurrentTime(0);
        saveReadingProgress(0);
      };

      startTimeRef.current = ctx.currentTime;
      lastSavedTimeRef.current = resumeFrom;
      const offset = resumeFrom / playbackRate;
      source.start(0, Math.min(offset, audioBuffer.duration));
      sourceRef.current = source;
      setState(ReaderState.PLAYING);
    } catch (err: any) {
      const msg = err?.message ?? err?.toString?.() ?? '';
      setState(ReaderState.ERROR);
      if (msg.includes('API') || msg.includes('401') || msg.includes('403') || msg.includes('API key') || msg.includes('quota')) {
        setError('語音服務無法使用：請在 Vercel 專案設定中新增環境變數 GEMINI_API_KEY');
      } else {
        setError(msg || '語音產生失敗，請稍後再試');
      }
    }
  };

  const handlePlayPause = () => {
    const ctx = audioContextRef.current;
    if (state === ReaderState.PLAYING && ctx) {
      ctx.suspend();
      setState(ReaderState.PAUSED);
      saveReadingProgress(currentTime);
    } else if (state === ReaderState.PAUSED && ctx) {
      ctx.resume();
      startTimeRef.current = ctx.currentTime;
      lastSavedTimeRef.current = currentTime;
      setState(ReaderState.PLAYING);
    } else {
      playAudio();
    }
  };

  const handleStop = () => {
    try { sourceRef.current?.stop(); } catch(e) {}
    saveReadingProgress(currentTime);
    setState(ReaderState.IDLE);
    setCurrentTime(0);
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    if (gainNodeRef.current && audioContextRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(v, audioContextRef.current.currentTime, 0.05);
    }
  };

  const handlePlaybackRateChange = (r: number) => {
    setPlaybackRate(r);
    if (sourceRef.current && audioContextRef.current) {
      sourceRef.current.playbackRate.setTargetAtTime(r, audioContextRef.current.currentTime, 0.05);
      startTimeRef.current = audioContextRef.current.currentTime;
      lastSavedTimeRef.current = currentTime;
    }
  };

  const normalizeUrl = (input: string) => {
    let url = input
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u3000/g, ' ')
      .trim();
    if (!url) return '';
    const match = url.match(/https?:\/\/[^\s]+/i);
    if (match) url = match[0];
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      new URL(url);
      return url;
    } catch {
      return '';
    }
  };

  const handleWebFetch = async () => {
    const url = normalizeUrl(webUrl);
    if (!url) {
      setWebError('請輸入正確的網址');
      return;
    }
    setWebError(null);
    setWebLoading(true);
    try {
      const res = await fetch('/api/fetch-novel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!res.ok) throw new Error('抓取失敗');
      const data = await res.json();
      setWebTitle(data.title || '');
      setWebText(data.content || '');
      if (!data.content) {
        setWebError('無法取得內容，可改為直接貼上文字');
      }
    } catch (err) {
      setWebError('抓取失敗，請改為直接貼上文字');
    } finally {
      setWebLoading(false);
    }
  };

  const handleWebPaste = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        setWebError('此瀏覽器不支援剪貼簿讀取，請手動貼上');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setWebError('剪貼簿沒有文字內容');
        return;
      }
      setWebText(text);
      setWebError(null);
    } catch {
      setWebError('無法讀取剪貼簿，請手動貼上');
    }
  };

  const handleWebPlayPause = () => {
    if (typeof speechSynthesis === 'undefined') {
      setWebError('此瀏覽器不支援語音朗讀');
      return;
    }
    if (webIsSpeaking && !webIsPaused) {
      speechSynthesis.pause();
      setWebIsPaused(true);
      return;
    }
    if (webIsSpeaking && webIsPaused) {
      speechSynthesis.resume();
      setWebIsPaused(false);
      return;
    }
    const text = webText.trim();
    if (!text) {
      setWebError('請先貼上文字或抓取內容');
      return;
    }
    setWebError(null);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = webRate;
    if (webVoice) {
      const voice = webVoices.find(v => v.name === webVoice);
      if (voice) utterance.voice = voice;
    }
    utterance.onend = () => {
      setWebIsSpeaking(false);
      setWebIsPaused(false);
      webUtteranceRef.current = null;
    };
    utterance.onerror = () => {
      setWebError('朗讀失敗，請稍後再試');
      setWebIsSpeaking(false);
      setWebIsPaused(false);
      webUtteranceRef.current = null;
    };
    webUtteranceRef.current = utterance;
    setWebIsSpeaking(true);
    setWebIsPaused(false);
    speechSynthesis.speak(utterance);
  };

  const handleWebStop = () => {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setWebIsSpeaking(false);
    setWebIsPaused(false);
    webUtteranceRef.current = null;
  };

  const handleWebAddToList = () => {
    const text = webText.trim();
    if (!text) {
      setWebError('沒有可加入清單的文字');
      return;
    }
    const title = webTitle.trim() || text.slice(0, 20);
    setWebList(prev => [{ id: String(Date.now()), title, text }, ...prev]);
    setWebError(null);
  };

  const handleWebLoadFromList = (id: string) => {
    const item = webList.find(i => i.id === id);
    if (!item) return;
    setWebTitle(item.title);
    setWebText(item.text);
  };

  const handleWebDeleteFromList = (id: string) => {
    setWebList(prev => prev.filter(i => i.id !== id));
  };

  const getThemeClass = () => {
    switch(theme) {
      case 'sepia': return 'bg-[#f4ecd8] text-[#5b4636] selection:bg-[#5b4636]/20';
      case 'slate': return 'bg-[#1e293b] text-slate-200 selection:bg-indigo-500/30';
      default: return 'bg-[#0b0f1a] text-slate-300 selection:bg-indigo-500/30';
    }
  };

  return (
    <div className={`min-h-screen pb-40 flex flex-col transition-colors duration-500 ${getThemeClass()}`}>
      <Header onToggleMenu={() => setIsMenuOpen(true)} />
      
      <Sidebar 
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenBrowse={() => setIsBrowseOpen(true)}
        onOpenLibrary={() => setIsBrowseOpen(true)}
        onNewSearch={() => setShowSearch(true)}
        currentNovelTitle={novel?.title}
      />

      {showResumeToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] bg-indigo-600 text-white px-5 py-2.5 rounded-full shadow-2xl animate-fade-in-up text-sm font-bold flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          已自動恢復上次閱讀進度
        </div>
      )}

      <main className="flex-1 container mx-auto px-4 md:px-6">
        <div className="max-w-4xl mx-auto pt-6 md:pt-10">
          <div className="flex justify-center mb-8">
            <div className="inline-flex bg-white/5 rounded-full p-1 border border-white/10">
              <button
                type="button"
                onClick={() => setReaderMode('novel')}
                className={`px-4 py-2 text-xs font-bold rounded-full transition-all ${readerMode === 'novel' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                小說閱讀
              </button>
              <button
                type="button"
                onClick={() => setReaderMode('web')}
                className={`px-4 py-2 text-xs font-bold rounded-full transition-all ${readerMode === 'web' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                手機朗讀器
              </button>
            </div>
          </div>
          
          {/* 只有在需要搜尋或尚未載入小說時顯示標題與輸入框 */}
          {readerMode === 'novel' && (showSearch || !novel) && (
            <div className="animate-fade-in-up">
              <div className="text-center mb-6">
                <h1 className="text-3xl md:text-5xl font-extrabold mb-3 tracking-tight">
                  聆聽您最 <span className="text-indigo-500 italic">喜愛</span> 的小說。
                </h1>
              </div>

              <NovelInput onSearch={handleSearch} isLoading={state === ReaderState.FETCHING} />

              {novel && (
                <div className="flex justify-center mb-8">
                  <button 
                    onClick={() => setShowSearch(false)}
                    className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-2 px-4 py-2 bg-indigo-500/10 rounded-full border border-indigo-500/20 transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                    返回閱讀模式
                  </button>
                </div>
              )}
            </div>
          )}

          {readerMode === 'novel' && error && (
            <div className="max-w-xl mx-auto mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          {readerMode === 'novel' && (
            <div style={{ fontSize: `${fontSize}px` }}>
              <NovelDisplay novel={novel} isLoading={state === ReaderState.FETCHING} onNextChapter={handleNextChapter} />
            </div>
          )}

          {readerMode === 'web' && (
            <div className="space-y-6">
              {!isOnline && (
                <div className="bg-orange-500/10 border border-orange-500/30 text-orange-300 text-xs rounded-2xl px-4 py-3">
                  目前離線：無法抓取網址內容，但仍可貼上文字朗讀。
                </div>
              )}

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-300 font-bold">手機快速分享貼上</div>
                  <button
                    type="button"
                    onClick={() => setShowShareHelp(!showShareHelp)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    {showShareHelp ? '收起' : '展開'}
                  </button>
                </div>
                {showShareHelp && (
                  <div className="text-xs text-slate-400 space-y-2">
                    <div>iOS：在原頁面點「分享」→「拷貝」→ 回此頁按「從剪貼簿貼上」。</div>
                    <div>Android：在原頁面點「分享」→「複製連結或文字」→ 回此頁按「從剪貼簿貼上」。</div>
                    <div>若剪貼簿無法讀取，請手動長按貼上。</div>
                  </div>
                )}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6 space-y-4">
                <div className="text-sm text-slate-300 font-bold">網址抓取（需後端支援）</div>
                <div className="flex flex-col md:flex-row gap-3">
                  <input
                    value={webUrl}
                    onChange={(e) => setWebUrl(e.target.value)}
                    placeholder="貼上網址（例如 https://example.com）"
                    className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleWebFetch}
                    disabled={webLoading}
                    className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50"
                  >
                    {webLoading ? '抓取中...' : '抓取內容'}
                  </button>
                </div>
                <div className="text-xs text-slate-500">
                  GitHub Pages 為純前端，無法抓取網址；請改用貼文字朗讀。
                </div>
                {webError && (
                  <div className="text-xs text-orange-400">{webError}</div>
                )}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-300 font-bold">可直接貼上文字</div>
                  <button
                    type="button"
                    onClick={handleWebPaste}
                    className="text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    從剪貼簿貼上
                  </button>
                </div>
                {webTitle && (
                  <div className="text-xs text-slate-500">標題：{webTitle}</div>
                )}
                <textarea
                  value={webText}
                  onChange={(e) => setWebText(e.target.value)}
                  placeholder="貼上要朗讀的文字"
                  rows={10}
                  className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
                <div className="flex flex-col md:flex-row md:items-center gap-4 pt-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleWebPlayPause}
                      className="px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold"
                    >
                      {webIsSpeaking && !webIsPaused ? '暫停' : webIsPaused ? '繼續' : '播放'}
                    </button>
                    <button
                      type="button"
                      onClick={handleWebStop}
                      className="px-4 py-2 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-bold"
                    >
                      停止
                    </button>
                    <button
                      type="button"
                      onClick={handleWebAddToList}
                      className="px-4 py-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold"
                    >
                      加入清單
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 font-bold">{webRate.toFixed(1)}x</span>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={webRate}
                      onChange={(e) => setWebRate(parseFloat(e.target.value))}
                      className="w-40 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-bold">語音</span>
                    <select
                      value={webVoice}
                      onChange={(e) => setWebVoice(e.target.value)}
                      className="bg-slate-800 text-xs font-bold rounded-lg px-2 py-1 focus:outline-none border border-white/5 text-white max-w-[180px]"
                    >
                      {webVoices.length === 0 && <option value="">預設</option>}
                      {webVoices.map(v => (
                        <option key={v.name} value={v.name}>
                          {v.name} ({v.lang || 'unknown'})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6 space-y-3">
                <div className="text-sm text-slate-300 font-bold">朗讀清單</div>
                {webList.length === 0 && (
                  <div className="text-xs text-slate-500">尚無項目，請先加入清單。</div>
                )}
                {webList.length > 0 && (
                  <div className="space-y-2">
                    {webList.map(item => (
                      <div key={item.id} className="flex items-center justify-between gap-3 bg-slate-900/40 border border-white/5 rounded-xl px-3 py-2">
                        <div className="text-xs text-slate-200 truncate flex-1">{item.title}</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleWebLoadFromList(item.id)}
                            className="text-xs text-indigo-400 hover:text-indigo-300"
                          >
                            載入
                          </button>
                          <button
                            type="button"
                            onClick={() => handleWebDeleteFromList(item.id)}
                            className="text-xs text-slate-400 hover:text-slate-200"
                          >
                            刪除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 固定底部播放列 */}
      {readerMode === 'novel' && (
        <div className="fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-center gap-4 px-4 py-4 bg-slate-900/95 border-t border-white/10 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.4)]">
          <span className="text-slate-400 text-sm font-medium truncate max-w-[120px] md:max-w-[200px]" title={novel?.title}>{novel?.title || '未選書'}</span>
          <button
            type="button"
            onClick={handlePlayPause}
            disabled={state === ReaderState.READING}
            className="flex-shrink-0 w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-white shadow-lg transition-colors"
            title={state === ReaderState.READING ? '正在產生語音…' : state === ReaderState.PLAYING ? '暫停' : '播放'}
          >
            {state === ReaderState.READING ? (
              <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.22-8.6" strokeLinecap="round"/></svg>
            ) : state === ReaderState.PLAYING ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button
            type="button"
            onClick={handleStop}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300 transition-colors"
            title="停止"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
          <span className="text-slate-500 text-xs tabular-nums">
            {Math.floor(currentTime / 60)}:{(Math.floor(currentTime % 60)).toString().padStart(2, '0')}
            {duration > 0 && ` / ${Math.floor(duration / 60)}:${(Math.floor(duration % 60)).toString().padStart(2, '0')}`}
          </span>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-[2rem] p-8 shadow-2xl text-slate-100 animate-fade-in-up">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">閱讀偏好</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
            </div>
            <div className="space-y-8">
              <div><label className="block text-sm font-bold text-slate-400 mb-3 uppercase tracking-widest">字體大小 ({fontSize}px)</label><input type="range" min="14" max="32" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" /></div>
              <div><label className="block text-sm font-bold text-slate-400 mb-4 uppercase tracking-widest">閱讀主題</label><div className="grid grid-cols-3 gap-3">{['dark', 'sepia', 'slate'].map(t => (<button key={t} onClick={() => setTheme(t as any)} className={`py-4 rounded-2xl border transition-all font-bold ${theme === t ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-lg shadow-indigo-500/10' : 'border-white/5 bg-white/5 text-slate-500 hover:bg-white/10'}`}>{t === 'dark' ? '深邃黑' : t === 'sepia' ? '羊皮紙' : '岩板灰'}</button>))}</div></div>
            </div>
            <button onClick={() => setIsSettingsOpen(false)} className="w-full mt-10 py-5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl transition-all shadow-xl shadow-indigo-600/20">確認儲存</button>
          </div>
        </div>
      )}

      {/* Browse Modal */}
      {isBrowseOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 w-full max-w-2xl rounded-[2rem] p-8 shadow-2xl text-slate-100 animate-fade-in-up">
            <div className="flex justify-between items-center mb-8"><div><h2 className="text-2xl font-bold">瀏覽書源</h2><p className="text-slate-400 text-sm mt-1">開啟連結搜尋後，將網址貼回首頁輸入框。</p></div><button onClick={() => setIsBrowseOpen(false)} className="text-slate-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[ { name: '番茄小說', url: 'https://fanqienovel.com/', c: 'bg-orange-500' }, { name: '起點中文網', url: 'https://www.qidian.com/', c: 'bg-red-600' }, { name: '晉江文學城', url: 'https://www.jjwxc.net/', c: 'bg-green-600' }, { name: '縱橫中文網', url: 'https://www.zongheng.com/', c: 'bg-blue-600' } ].map(site => (
                <a key={site.name} href={site.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all group">
                  <div className={`w-12 h-12 rounded-xl ${site.c} flex items-center justify-center text-white font-bold shadow-lg`}>{site.name[0]}</div>
                  <div><h3 className="font-bold group-hover:text-indigo-400 transition-colors">{site.name}</h3><p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">前往官方網站</p></div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {theme === 'dark' && (<><div className="fixed -top-24 -left-24 w-96 h-96 bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none -z-10"></div><div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none -z-10"></div></>)}
    </div>
  );
};

export default App;
