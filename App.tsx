
import React, { useState, useRef, useEffect } from 'react';
import Header from './components/Header.tsx';
import Sidebar from './components/Sidebar.tsx';
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

const App: React.FC = () => {
  const [novel, setNovel] = useState<NovelContent | null>(null);
  const [voice, setVoice] = useState('Kore');
  const [volume, setVolume] = useState(0.8);
  const [playbackRate, setPlaybackRate] = useState(0.8);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(true);
  const [fontSize, setFontSize] = useState(20);
  const [theme, setTheme] = useState<'dark' | 'sepia' | 'slate'>('dark');

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

    const loadVoices = () => {
      setWebVoices(window.speechSynthesis.getVoices());
    };
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
      setNovel(data);
      setWebTitle(data.title);
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

    // 如果正在 AI 朗讀
    if (webAiPlayingRef.current && audioContextRef.current) {
      if (!webIsPaused) {
        await audioContextRef.current.suspend();
        setWebIsPaused(true);
      } else {
        await audioContextRef.current.resume();
        setWebIsPaused(false);
      }
      return;
    }

    // 如果正在原生語音朗讀
    if (window.speechSynthesis.speaking && !webAiPlayingRef.current) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setWebIsPaused(false);
      } else {
        window.speechSynthesis.pause();
        setWebIsPaused(true);
      }
      return;
    }

    // 開始新的朗讀
    if (useAiReading) {
      handleWebStop();
      const segments = splitTextForTTS(text, 1200);
      setWebAiLoading(true);
      const ctx = initAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      webAiPlayingRef.current = true;
      
      const playNextSegment = async (index: number) => {
        if (!webAiPlayingRef.current || index >= segments.length) {
          handleWebStop();
          return;
        }
        try {
          const base64Audio = await generateSpeech(segments[index], 'Kore');
          const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.onended = () => {
            if (webAiPlayingRef.current) playNextSegment(index + 1);
          };
          source.start(0);
          sourceRef.current = source;
          setWebIsSpeaking(true);
          setWebIsPaused(false);
          setWebAiLoading(false);
        } catch (e) {
          setWebError("AI 朗讀出錯。");
          handleWebStop();
        }
      };
      playNextSegment(0);
    } else {
      handleWebStop();
      const utterance = new SpeechSynthesisUtterance(text);
      if (webVoice) {
        const selectedVoice = webVoices.find(v => v.name === webVoice);
        if (selectedVoice) utterance.voice = selectedVoice;
      }
      utterance.rate = webRate;
      utterance.onstart = () => {
        setWebIsSpeaking(true);
        setWebIsPaused(false);
      };
      utterance.onend = () => {
        setWebIsSpeaking(false);
        setWebIsPaused(false);
      };
      utterance.onerror = () => handleWebStop();
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleWebStop = () => {
    // 停止 AI 朗讀
    if (webAiPlayingRef.current) {
      webAiPlayingRef.current = false;
      try { sourceRef.current?.stop(); } catch {}
      sourceRef.current = null;
    }
    // 停止原生語音
    if (typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.cancel();
    }
    setWebIsSpeaking(false);
    setWebIsPaused(false);
    setWebAiLoading(false);
  };

  const getThemeClass = () => {
    switch(theme) {
      case 'sepia': return 'bg-[#f4ecd8] text-[#5b4636]';
      case 'slate': return 'bg-[#1e293b] text-slate-200';
      default: return 'bg-[#0b0f1a] text-slate-300';
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
                <h2 className="text-4xl md:text-6xl font-bold serif-font tracking-tight mb-4">
                  {webTitle || novel?.title}
                </h2>
                <div className="w-24 h-1 bg-indigo-500/30 mx-auto rounded-full"></div>
              </header>
            )}

            {webError && (
              <div className="p-4 bg-red-900/20 text-red-400 rounded-2xl border border-red-500/20 text-center animate-fade-in-up">
                {webError}
              </div>
            )}
            
            <textarea
              value={webText}
              onChange={(e) => setWebText(e.target.value)}
              placeholder="在此貼上小說內容，或從側邊欄使用「網址抓取」..."
              style={{ 
                fontSize: `${fontSize}px`,
                fieldSizing: 'content' as any 
              }}
              className="w-full bg-transparent border-0 focus:ring-0 leading-[2] resize-none overflow-hidden serif-font placeholder:opacity-30 min-h-screen"
            />
          </div>
        </div>
      </main>

      {/* 懸浮控制列 */}
      <div className="fixed bottom-0 left-0 right-0 p-6 z-[100] bg-gradient-to-t from-slate-950/80 via-slate-950/40 to-transparent backdrop-blur-sm pointer-events-none">
        <div className="max-w-md mx-auto flex justify-center items-center gap-6 pointer-events-auto">
          <button 
            onClick={() => novel?.prevChapterUrl && handleSearch(novel.prevChapterUrl)} 
            disabled={!novel?.prevChapterUrl} 
            className="p-4 bg-slate-900/80 border border-white/5 rounded-full disabled:opacity-30 hover:bg-slate-800 transition-all active:scale-95 shadow-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          
          <button 
            onClick={handleWebPlayPause} 
            className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-2xl shadow-indigo-600/40 hover:scale-105 active:scale-95 transition-all"
          >
            {webAiLoading ? (
              <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              webIsSpeaking && !webIsPaused ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><path d="m7 4 12 8-12 8V4z"/></svg>
              )
            )}
          </button>

          <button 
            onClick={handleWebStop} 
            className="p-4 bg-slate-900/80 border border-white/5 rounded-full hover:bg-slate-800 transition-all active:scale-95 shadow-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>
          </button>
          
          <button 
            onClick={() => novel?.nextChapterUrl && handleSearch(novel.nextChapterUrl)} 
            disabled={!novel?.nextChapterUrl} 
            className="p-4 bg-slate-900/80 border border-white/5 rounded-full disabled:opacity-30 hover:bg-slate-800 transition-all active:scale-95 shadow-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      </div>

      {isUrlModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl text-slate-100 animate-fade-in-up">
            <h2 className="text-2xl font-bold mb-6 text-center">開始閱讀</h2>
            <div className="space-y-4">
              <input 
                value={webUrl} 
                onChange={(e) => setWebUrl(e.target.value)} 
                placeholder="輸入小說網址或書名關鍵字..." 
                className="w-full bg-slate-800 border border-white/5 p-5 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all" 
              />
              <button 
                onClick={() => { handleSearch(webUrl); setIsUrlModalOpen(false); }} 
                disabled={webLoading} 
                className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-600/20 transition-all active:scale-95 flex items-center justify-center gap-3"
              >
                {webLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : '立即解析'}
              </button>
              <button onClick={() => setIsUrlModalOpen(false)} className="w-full mt-2 text-slate-400 hover:text-white transition-colors">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
