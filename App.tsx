
import React, { useState, useRef, useEffect } from 'react';
import { NovelContent, ReaderState } from './types.ts';
import { fetchNovelContent, generateSpeech } from './services/geminiService.ts';
import { decode, decodeAudioData } from './utils/audioUtils.ts';
import { getSafeOpenUrl } from './utils/urlUtils.ts';
import * as OpenCC from 'opencc-js';

const STORAGE_KEY_SETTINGS = 'gemini_reader_settings';
const STORAGE_KEY_PROGRESS = 'gemini_reader_progress';
const STORAGE_KEY_WEB_RATE = 'web_reader_rate';
const STORAGE_KEY_WEB_VOICE = 'web_reader_voice';
const STORAGE_KEY_USE_AI_READING = 'gemini_reader_use_ai';
type BookmarkData = {
  id: string;
  title: string;
  sourceUrl: string;
  scrollTop: number;
  readingCharIndex: number | null;
  savedAt: number;
};
const s2tConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });

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

/** 依與 textarea 相同的斷行與字體量測字元在可捲動內容中的垂直位置（含自動換行，非僅 \\n） */
function getScrollContentOffsetTopForCharIndex(textarea: HTMLTextAreaElement, charIndex: number): number {
  const text = textarea.value;
  const i = Math.max(0, Math.min(charIndex, text.length));
  const div = document.createElement('div');
  const cs = window.getComputedStyle(textarea);
  div.style.position = 'absolute';
  div.style.left = '-99999px';
  div.style.top = '0';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.overflow = 'hidden';
  div.style.width = `${textarea.clientWidth}px`;
  div.style.boxSizing = cs.boxSizing || 'border-box';
  div.style.padding = cs.padding;
  div.style.border = cs.border;
  div.style.font = cs.font;
  div.style.fontSize = cs.fontSize;
  div.style.fontFamily = cs.fontFamily;
  div.style.fontWeight = cs.fontWeight;
  div.style.fontStyle = cs.fontStyle;
  div.style.letterSpacing = cs.letterSpacing;
  div.style.lineHeight = cs.lineHeight;

  div.textContent = text.slice(0, i);
  const marker = document.createElement('span');
  marker.textContent = i < text.length ? text.slice(i, i + 1) : '\u200b';
  div.appendChild(marker);

  document.body.appendChild(div);
  const top = marker.offsetTop;
  document.body.removeChild(div);
  return top;
}

type LocalHeaderProps = {
  onToggleMenu: () => void;
  title?: string;
};

const Header: React.FC<LocalHeaderProps> = ({ onToggleMenu, title }) => (
  <header className="relative flex items-center justify-center gap-3 px-4 md:px-6 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
    <div className="max-w-[70%] text-base md:text-lg font-bold truncate text-slate-100 text-center">
      {title || '未命名章節'}
    </div>
    <button onClick={onToggleMenu} className="absolute right-4 md:right-6 px-3 py-2 rounded-lg bg-slate-700 text-slate-50 font-semibold border border-white/20 hover:bg-slate-600 shrink-0">
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
  onConvertToTraditional?: () => void;
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
  onConvertToTraditional,
  onOpenUrlModal,
  currentNovelTitle
}) => (
  <div className={`fixed top-0 right-0 h-full w-[300px] bg-slate-900/95 border-l border-white/15 z-[160] transition-transform duration-500 ease-out shadow-2xl flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
    <div className="p-4 border-b border-white/15 flex items-center justify-between">
      <span className="font-bold text-slate-100 text-base">選單</span>
      <button onClick={onClose} className="text-slate-200 text-sm font-semibold px-2 py-1 rounded bg-slate-700/60 hover:bg-slate-600/70">關閉</button>
    </div>
    <div className="p-4 space-y-3">
      {currentNovelTitle ? <div className="text-sm text-slate-100/95 truncate font-medium">{currentNovelTitle}</div> : null}
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onNewSearch(); onClose(); }}>新搜尋</button>
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onOpenUrlModal?.(); onClose(); }}>網址抓取</button>
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onConvertToTraditional?.(); onClose(); }}>簡轉繁</button>
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onOpenBrowse(); onClose(); }}>瀏覽書源</button>
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onOpenSettings(); onClose(); }}>閱讀偏好</button>
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
  const [isChaptersOpen, setIsChaptersOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(true);
  const [fontSize, setFontSize] = useState(22);
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkData[]>([]);
  const [isBookmarkListOpen, setIsBookmarkListOpen] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pendingRestoreRef = useRef<BookmarkData | null>(null);
  const webAiPlayingRef = useRef(false);
  const webTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const boundaryTickRef = useRef<number | null>(null);
  const ttsStartAtRef = useRef<number>(0);
  const hasBoundaryEventRef = useRef<boolean>(false);
  const lastAutoScrollAtRef = useRef<number>(0);
  const aiProgressRafRef = useRef<number | null>(null);
  const aiSegmentProgressRef = useRef<{
    ctx: AudioContext;
    startCtxTime: number;
    duration: number;
    charStart: number;
    charEnd: number;
  } | null>(null);
  const [readingCharIndex, setReadingCharIndex] = useState<number | null>(null);
  const [readingLineViewportY, setReadingLineViewportY] = useState<number | null>(null);
  const [readingLineHeight, setReadingLineHeight] = useState<number>(36);

  const stopAiProgressLoop = () => {
    if (aiProgressRafRef.current !== null) {
      cancelAnimationFrame(aiProgressRafRef.current);
      aiProgressRafRef.current = null;
    }
    aiSegmentProgressRef.current = null;
  };

  const startAiProgressLoop = () => {
    const tick = () => {
      const meta = aiSegmentProgressRef.current;
      if (!meta || !webAiPlayingRef.current) return;
      if (meta.ctx.state !== 'running' && meta.ctx.state !== 'closed') {
        aiProgressRafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = meta.ctx.currentTime - meta.startCtxTime;
      const progress = meta.duration > 0 ? Math.min(1, Math.max(0, elapsed / meta.duration)) : 1;
      const span = meta.charEnd - meta.charStart;
      let idx: number;
      if (span <= 1) idx = meta.charStart;
      else idx = meta.charStart + Math.min(span - 1, Math.floor(progress * span));
      setReadingCharIndex(idx);
      aiProgressRafRef.current = requestAnimationFrame(tick);
    };
    if (aiProgressRafRef.current !== null) cancelAnimationFrame(aiProgressRafRef.current);
    aiProgressRafRef.current = requestAnimationFrame(tick);
  };

  const syncReadingPosition = (charIndex: number | null) => {
    const textarea = webTextareaRef.current;
    if (!textarea || charIndex === null) {
      setReadingLineViewportY(null);
      return;
    }
    const clamped = Math.max(0, Math.min(charIndex, textarea.value.length));
    const computed = window.getComputedStyle(textarea);
    const parsedLineHeight = parseFloat(computed.lineHeight || '');
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 2.2;
    const targetTop = Math.max(0, getScrollContentOffsetTopForCharIndex(textarea, clamped));
    const viewportHeight = textarea.clientHeight || 600;
    const currentTop = textarea.scrollTop;
    const lineYInViewport = targetTop - currentTop;
    setReadingLineViewportY(Math.max(0, lineYInViewport));
    setReadingLineHeight(lineHeight);
    const anchorRatio = 0.38; // 再微幅上移，避免視覺偏下
    const safeTop = viewportHeight * 0.26;
    const safeBottom = viewportHeight * 0.5;
    const now = Date.now();
    const minStepPx = Math.max(lineHeight * 0.7, 20); // 太小就忽略，避免抖動但保留校正能力
    const throttleMs = Math.max(350, Math.min(900, lineHeight * 12)); // 字越大，捲動節流越長

    // 朗讀行仍在中央安全區就不捲動，避免視覺抖動。
    if (lineYInViewport >= safeTop && lineYInViewport <= safeBottom) return;
    if (now - lastAutoScrollAtRef.current < throttleMs) return;
    const desiredTop = Math.max(0, targetTop - viewportHeight * anchorRatio);
    const nextTop = desiredTop;
    if (Math.abs(nextTop - currentTop) < minStepPx) return;

    lastAutoScrollAtRef.current = now;
    textarea.scrollTo({ top: nextTop, behavior: 'auto' });
  };

  useEffect(() => {
    if (readingCharIndex === null) {
      setReadingLineViewportY(null);
      return;
    }
    syncReadingPosition(readingCharIndex);
  }, [readingCharIndex, fontSize]);

  useEffect(() => {
    const textarea = webTextareaRef.current;
    if (!textarea) return;
    const handleScroll = () => {
      if (readingCharIndex !== null) syncReadingPosition(readingCharIndex);
    };
    textarea.addEventListener('scroll', handleScroll);
    return () => textarea.removeEventListener('scroll', handleScroll);
  }, [readingCharIndex, fontSize]);

  useEffect(() => {
    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      const s = JSON.parse(savedSettings);
      setVoice(s.voice || 'Kore');
      setVolume(s.volume ?? 0.8);
      setPlaybackRate(s.playbackRate ?? 0.8);
      setFontSize(s.fontSize ?? 22);
      setTheme(s.theme || 'dark');
    }
    const savedWebRate = localStorage.getItem(STORAGE_KEY_WEB_RATE);
    if (savedWebRate) setWebRate(parseFloat(savedWebRate));
    const savedUseAi = localStorage.getItem(STORAGE_KEY_USE_AI_READING);
    if (savedUseAi === 'true') setUseAiReading(true);
    const savedProgress = localStorage.getItem(STORAGE_KEY_PROGRESS);
    if (savedProgress) {
      try {
        const parsed = JSON.parse(savedProgress);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const normalized = list.filter((x) => x?.sourceUrl).map((x) => ({
          id: x.id || `${x.savedAt || Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: x.title || '未命名章節',
          sourceUrl: x.sourceUrl,
          scrollTop: Number(x.scrollTop || 0),
          readingCharIndex: typeof x.readingCharIndex === 'number' ? x.readingCharIndex : null,
          savedAt: Number(x.savedAt || Date.now()),
        })) as BookmarkData[];
        setBookmarks(normalized);
        if (normalized.length > 0) setShowResumeToast(true);
      } catch {
        // ignore invalid bookmark payload
      }
    }

    const loadVoices = () => setWebVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  useEffect(() => {
    const pending = pendingRestoreRef.current;
    const textarea = webTextareaRef.current;
    if (!pending || !textarea || !webText.trim()) return;
    textarea.scrollTo({ top: Math.max(0, pending.scrollTop), behavior: 'auto' });
    setReadingCharIndex(pending.readingCharIndex ?? null);
    pendingRestoreRef.current = null;
  }, [webText]);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      try {
        // 手機瀏覽器（特別是部分 iOS/Safari）對指定 sampleRate 相容性較差，先用預設值。
        audioContextRef.current = new Ctx();
      } catch {
        // 後備：若預設建構失敗，再嘗試舊設定。
        audioContextRef.current = new Ctx({ sampleRate: 24000 });
      }
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
      setIsChaptersOpen(false);
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

  const startBrowserSpeech = (fullText: string, offset: number, text: string) => {
    handleWebStop();
    const utterance = new SpeechSynthesisUtterance(text);
    if (webVoice) { const selectedVoice = webVoices.find(v => v.name === webVoice); if (selectedVoice) utterance.voice = selectedVoice; }
    utterance.rate = webRate;
    utterance.onstart = () => {
      setWebIsSpeaking(true);
      setWebIsPaused(false);
      setReadingCharIndex(offset);
      ttsStartAtRef.current = Date.now();
      hasBoundaryEventRef.current = false;
      if (boundaryTickRef.current) window.clearInterval(boundaryTickRef.current);
      // 部分瀏覽器/語音不會穩定觸發 onboundary，使用時間估算做備援同步。
      boundaryTickRef.current = window.setInterval(() => {
        if (!window.speechSynthesis.speaking || window.speechSynthesis.paused) return;
        if (hasBoundaryEventRef.current) return; // 一旦有 boundary 事件，改用事件同步，避免雙來源抖動
        const elapsedSec = (Date.now() - ttsStartAtRef.current) / 1000;
        const charsPerSec = Math.max(4, 8 * webRate);
        const estimatedIndex = Math.floor(elapsedSec * charsPerSec);
        setReadingCharIndex((prev) => {
          const next = Math.min(fullText.length, offset + estimatedIndex);
          if (prev === null) return next;
          return Math.max(prev, next);
        });
      }, 180);
    };
    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (typeof event.charIndex !== 'number') return;
      hasBoundaryEventRef.current = true;
      const next = Math.min(fullText.length, offset + event.charIndex);
      setReadingCharIndex((prev) => {
        if (prev === null) return next;
        return Math.max(prev, next); // 防止某些語音引擎偶發回退索引造成跳動
      });
    };
    utterance.onend = () => {
      if (boundaryTickRef.current) { window.clearInterval(boundaryTickRef.current); boundaryTickRef.current = null; }
      setWebIsSpeaking(false);
      setWebIsPaused(false);
      setReadingCharIndex(null);
    };
    utterance.onerror = () => handleWebStop();
    window.speechSynthesis.speak(utterance);
  };

  const handleWebPlayPause = async () => {
    const fullText = webText;
    if (!fullText.trim()) return;
    const firstContentIndex = fullText.search(/\S/);
    const offset = firstContentIndex >= 0 ? firstContentIndex : 0;
    const text = fullText.slice(offset);
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
        stopAiProgressLoop();
        try {
          const currentSegment = segments[index];
          setReadingCharIndex(offset + currentSegment.start);
          const base64Audio = await generateSpeech(currentSegment.text, 'Kore');
          const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.onended = () => {
            stopAiProgressLoop();
            if (webAiPlayingRef.current) playNextSegment(index + 1);
          };
          source.start(0);
          sourceRef.current = source;
          aiSegmentProgressRef.current = {
            ctx,
            startCtxTime: ctx.currentTime,
            duration: audioBuffer.duration,
            charStart: offset + currentSegment.start,
            charEnd: offset + currentSegment.end,
          };
          startAiProgressLoop();
          setWebIsSpeaking(true); setWebIsPaused(false); setWebAiLoading(false);
        } catch (e: any) {
          // AI 失敗時靜默降級到系統朗讀，避免錯誤訊息長駐畫面。
          setWebError((prev) => (prev?.startsWith('AI 朗讀') ? null : prev));
          webAiPlayingRef.current = false;
          stopAiProgressLoop();
          sourceRef.current = null;
          setWebAiLoading(false);
          console.warn('AI 朗讀失敗，已自動切換系統朗讀', e);
          startBrowserSpeech(fullText, offset, text);
        }
      };
      playNextSegment(0);
    } else {
      startBrowserSpeech(fullText, offset, text);
    }
  };

  const handleWebStop = () => {
    stopAiProgressLoop();
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

  const showToast = (msg: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 1800);
  };

  const handleSaveBookmark = () => {
    const textarea = webTextareaRef.current;
    if (!webText.trim() || !textarea) {
      showToast('目前沒有可儲存的內容');
      return;
    }
    const payload: BookmarkData = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: webTitle || novel?.title || '未命名章節',
      sourceUrl: novel?.sourceUrl || webUrl || '',
      scrollTop: textarea.scrollTop,
      readingCharIndex,
      savedAt: Date.now(),
    };
    const next = [payload, ...bookmarks].slice(0, 30);
    setBookmarks(next);
    localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(next));
    setShowResumeToast(true);
    showToast('書籤已儲存');
  };

  const handleRestoreBookmark = async (target?: BookmarkData) => {
    const chosen = target || bookmarks[0];
    if (!chosen) {
      showToast('尚未儲存書籤');
      return;
    }
    if (!chosen?.sourceUrl) {
      showToast('書籤缺少來源網址');
      return;
    }
    pendingRestoreRef.current = chosen;
    setShowResumeToast(false);
    setIsBookmarkListOpen(false);
    await handleSearch(chosen.sourceUrl);
    showToast('已回到書籤位置');
  };

  const handleOpenBookmarkList = () => {
    if (bookmarks.length === 0) {
      showToast('尚未儲存書籤');
      return;
    }
    setIsBookmarkListOpen(true);
  };

  const handleDeleteBookmark = (id: string) => {
    const next = bookmarks.filter((b) => b.id !== id);
    setBookmarks(next);
    localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(next));
    if (next.length === 0) {
      setShowResumeToast(false);
      setIsBookmarkListOpen(false);
    }
  };

  const handleConvertToTraditional = () => {
    if (!webText.trim()) {
      showToast('目前沒有可轉換的內容');
      return;
    }
    setWebText((prev) => s2tConverter(prev));
    setWebTitle((prev) => (prev ? s2tConverter(prev) : prev));
    setNovel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        title: prev.title ? s2tConverter(prev.title) : prev.title,
        content: s2tConverter(prev.content || ''),
        chapters: prev.chapters?.map((ch) => ({ ...ch, title: ch.title ? s2tConverter(ch.title) : ch.title })),
      };
    });
    showToast('已轉為繁體');
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-500 ${getThemeClass()}`}>
      <Header onToggleMenu={() => setIsMenuOpen(true)} title={webTitle || novel?.title} />
      
      <Sidebar 
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenBrowse={() => setIsBrowseOpen(true)}
        onOpenLibrary={() => setIsBrowseOpen(true)}
        onNewSearch={() => setShowSearch(true)}
        onConvertToTraditional={handleConvertToTraditional}
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
        <div className="max-w-[90rem] mx-auto pt-6 md:pt-8">
          <div className="space-y-8 pb-48">
            {webError && (
              <div className="p-4 bg-red-900/20 text-red-400 rounded-2xl border border-red-500/20 text-center animate-fade-in-up">
                {webError}
              </div>
            )}

            {!!novel?.chapters?.length && (
              <section className="rounded-2xl border border-white/10 bg-slate-900/40">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-slate-100 font-semibold"
                  onClick={() => setIsChaptersOpen((v) => !v)}
                >
                  <span>章節目錄（{novel.chapters.length}）</span>
                  <span className="text-slate-300">{isChaptersOpen ? '收合' : '展開'}</span>
                </button>
                {isChaptersOpen && (
                  <div className="max-h-64 overflow-y-auto border-t border-white/10 px-2 py-2">
                    {novel.chapters.map((ch, idx) => (
                      <button
                        key={`${ch.url}-${idx}`}
                        className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-white/10"
                        onClick={() => ch.url && handleSearch(ch.url)}
                      >
                        {ch.title || `第 ${idx + 1} 章`}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            <div className="relative w-full">
              {readingLineViewportY !== null && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10 transition-[top] duration-150"
                  style={{ top: Math.max(0, readingLineViewportY - 2), height: readingLineHeight + 4 }}
                >
                  <div className={`w-full h-full rounded-sm ${theme === 'sepia' ? 'bg-[#5b4636]/10' : 'bg-indigo-400/12'}`}></div>
                </div>
              )}
              <textarea
                ref={webTextareaRef}
                value={webText}
                onChange={(e) => setWebText(e.target.value)}
                placeholder="在此貼上小說內容，或從側邊欄使用「網址抓取」..."
                style={{ 
                  fontSize: `${fontSize}px`
                }}
                className={`relative z-20 w-full h-[76vh] bg-transparent border-0 focus:ring-0 leading-[2.2] resize-none overflow-y-auto serif-font ${theme === 'sepia' ? 'placeholder:text-[#5b4636]/30' : 'placeholder:opacity-30'}`}
              />
            </div>
          </div>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-4 z-[100] bg-gradient-to-t from-black/80 via-black/40 to-transparent backdrop-blur-sm pointer-events-none">
        <div className="max-w-md mx-auto flex justify-center items-center gap-4 pointer-events-auto">
          <button onClick={() => novel?.prevChapterUrl && handleSearch(novel.prevChapterUrl)} disabled={!novel?.prevChapterUrl} className="p-3 bg-slate-700 text-slate-50 border border-white/20 rounded-full disabled:opacity-30 hover:bg-slate-600 transition-all shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button onClick={handleWebPlayPause} className="p-3 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl hover:scale-105 active:scale-95 transition-all">
            {webAiLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : (webIsSpeaking && !webIsPaused ? <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><path d="m7 4 12 8-12 8V4z"/></svg>)}
          </button>
          <button onClick={handleWebStop} className="p-3 bg-rose-600 text-white border border-rose-300/40 rounded-full flex items-center justify-center hover:bg-rose-500 transition-all shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>
          </button>
          <button onClick={handleSaveBookmark} className="p-3 bg-amber-500 text-slate-950 border border-amber-200/50 rounded-full flex items-center justify-center hover:bg-amber-400 transition-all shadow-lg" title="儲存書籤">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3a2 2 0 0 0-2 2v16l8-4.5L20 21V5a2 2 0 0 0-2-2H6z"/></svg>
          </button>
          <button onClick={handleOpenBookmarkList} className="p-3 bg-emerald-500 text-white border border-emerald-200/50 rounded-full flex items-center justify-center hover:bg-emerald-400 transition-all shadow-lg" title="回到書籤">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>
          </button>
          <button onClick={() => novel?.nextChapterUrl && handleSearch(novel.nextChapterUrl)} disabled={!novel?.nextChapterUrl} className="p-3 bg-slate-700 text-slate-50 border border-white/20 rounded-full disabled:opacity-30 hover:bg-slate-600 transition-all shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
        {showResumeToast && (
          <div className="mt-2 max-w-sm mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white/95">
              <span>偵測到已儲存書籤</span>
              <button className="px-2 py-1 rounded bg-emerald-500 text-white font-semibold" onClick={handleOpenBookmarkList}>選擇書籤</button>
            </div>
          </div>
        )}
        {toastMessage && (
          <div className="mt-3 text-center text-sm text-white/95 bg-black/60 border border-white/15 rounded-lg px-3 py-2 max-w-xs mx-auto pointer-events-auto">
            {toastMessage}
          </div>
        )}
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-[2rem] p-8 shadow-2xl text-slate-100 animate-fade-in-up">
            <div className="flex justify-between items-center mb-8"><h2 className="text-2xl font-bold">閱讀偏好</h2><button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>
            <div className="space-y-8">
              <div><label className="block text-sm font-bold text-slate-400 mb-3 uppercase tracking-widest">字體大小 ({fontSize}px)</label><input type="range" min="16" max="40" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" /></div>
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
                { name: '縱橫中文網', url: 'https://www.zongheng.com/', c: 'bg-blue-600' },
                { name: '稷下書院', url: 'https://www.novel543.com/', c: 'bg-violet-600' }
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

      {isBookmarkListOpen && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-3xl p-6 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">選擇書籤</h3>
              <button className="text-slate-300 hover:text-white" onClick={() => setIsBookmarkListOpen(false)}>關閉</button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              {bookmarks.map((b) => (
                <div key={b.id} className="flex items-center gap-2 p-2 rounded-xl bg-white/5 border border-white/10">
                  <button className="flex-1 text-left px-2 py-2 hover:bg-white/10 rounded-lg" onClick={() => handleRestoreBookmark(b)}>
                    <div className="font-semibold truncate">{b.title}</div>
                    <div className="text-xs text-slate-400">{new Date(b.savedAt).toLocaleString()}</div>
                  </button>
                  <button className="px-2 py-1 text-xs rounded bg-rose-600/80 hover:bg-rose-500" onClick={() => handleDeleteBookmark(b.id)}>刪除</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
