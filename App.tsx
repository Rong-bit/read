
import React, { useState, useRef, useEffect, useMemo } from 'react';
import Header from './components/header.tsx';
import Sidebar from './components/sidebar.tsx';
import { NovelContent, ReaderState } from './types.ts';
import { fetchNovelContent, generateSpeech } from './services/geminiService.ts';
import { decode, decodeAudioData } from './utils/audioUtils.ts';
import { getSafeOpenUrl } from './utils/urlUtils.ts';

const STORAGE_KEY_SETTINGS = 'gemini_reader_settings';
const STORAGE_KEY_PROGRESS = 'gemini_reader_progress';
const STORAGE_KEY_WEB_RATE = 'web_reader_rate';
const STORAGE_KEY_WEB_VOICE = 'web_reader_voice';
const STORAGE_KEY_WEB_LIST = 'web_reader_list';
const STORAGE_KEY_GEMINI_API_KEY = 'gemini_reader_api_key';
const STORAGE_KEY_USE_AI_READING = 'gemini_reader_use_ai';
const STORAGE_KEY_BOOKMARKS = 'gemini_reader_bookmarks_v1';

type BookmarkItem = {
  id: string;
  createdAt: number;
  sourceUrl: string; // 章節網址（若無則用 webUrl 或空字串）
  title: string; // 顯示用：章節/小說標題
  paragraphIdx: number;
  snippet: string;
};

function getNovelText(novel: NovelContent | null): string {
  if (!novel) return '';
  if (typeof (novel as any).content === 'string' && (novel as any).content.length > 0) return (novel as any).content;
  const chapters = (novel as any).chapters;
  if (Array.isArray(chapters)) return chapters.map((c: any) => c.text ?? c.content ?? '').join('\n');
  return '';
}

/** 將長文依段落與字數上限拆成多段，供 TTS 一段一段合成 */
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
  // --- States ---
  const [novel, setNovel] = useState<NovelContent | null>(null);
  const [state, setState] = useState<ReaderState>(ReaderState.IDLE);
  const [voice, setVoice] = useState('Kore');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [playbackRate, setPlaybackRate] = useState(0.8);
  
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(true);
  const [fontSize, setFontSize] = useState(18);
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
  const [webList, setWebList] = useState<Array<{ id: string; title: string; text: string }>>([]);
  const [showWebChapters, setShowWebChapters] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [hasBackend, setHasBackend] = useState<boolean | null>(null);
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [useAiReading, setUseAiReading] = useState(false);
  const [webAiLoading, setWebAiLoading] = useState(false);
  const [centerFollowEnabled, setCenterFollowEnabled] = useState(true);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true);
  const [isEditingText, setIsEditingText] = useState(false);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);

  // --- Refs ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const requestRef = useRef<number>(0);
  const lastSavedTimeRef = useRef<number>(0);
  const webUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const webSpeechStartTimeRef = useRef<number>(0);
  const webSpeechPausedElapsedRef = useRef<number>(0);
  const webEstimatedDurationRef = useRef<number>(0);
  const webSpeechTickRef = useRef<number>(0);
  const webAiPlayingRef = useRef(false);
  const [webSpeechElapsed, setWebSpeechElapsed] = useState(0);
  const [webSpeechTotalSec, setWebSpeechTotalSec] = useState(0);
  const webSpeechCharIndexRef = useRef<number>(0);
  const [webSpeechCharIndex, setWebSpeechCharIndex] = useState(0);
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollCheckRafRef = useRef<number | null>(null);
  const autoNextInFlightRef = useRef(false);
  const lastAutoNextAtRef = useRef<number>(0);
  const lastAutoNextFromRef = useRef<string>('');
  const paragraphElsRef = useRef(new Map<number, HTMLElement>());
  const pendingScrollToParagraphRef = useRef<number | null>(null);
  const lastFetchedUrlRef = useRef<string>('');
  const pendingAutoPlayAfterFetchRef = useRef(false);

  // --- Initialization ---
  useEffect(() => {
    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      const s = JSON.parse(savedSettings);
      setVoice(s.voice || 'Kore');
      setVolume(s.volume ?? 0.8);
      setPlaybackRate(s.playbackRate ?? 0.8);
      setFontSize(s.fontSize ?? 18);
      setTheme(s.theme || 'dark');
      setCenterFollowEnabled(s.centerFollowEnabled ?? true);
      setAutoNextEnabled(s.autoNextEnabled ?? true);
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

    const savedApiKey = localStorage.getItem(STORAGE_KEY_GEMINI_API_KEY);
    if (savedApiKey != null) setGeminiApiKey(savedApiKey);
    const savedUseAi = localStorage.getItem(STORAGE_KEY_USE_AI_READING);
    if (savedUseAi === 'true') setUseAiReading(true);

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

    const savedBookmarks = localStorage.getItem(STORAGE_KEY_BOOKMARKS);
    if (savedBookmarks) {
      try {
        const list = JSON.parse(savedBookmarks);
        if (Array.isArray(list)) setBookmarks(list);
      } catch {}
    }
  }, []);

  useEffect(() => {
    const settings = { voice, volume, playbackRate, fontSize, theme, centerFollowEnabled, autoNextEnabled };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  }, [voice, volume, playbackRate, fontSize, theme, centerFollowEnabled, autoNextEnabled]);

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
    localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(bookmarks));
  }, [bookmarks]);

  useEffect(() => {
    if (geminiApiKey !== undefined) localStorage.setItem(STORAGE_KEY_GEMINI_API_KEY, geminiApiKey);
  }, [geminiApiKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_USE_AI_READING, useAiReading ? 'true' : 'false');
  }, [useAiReading]);

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

  useEffect(() => {
    if (!isOnline) {
      setHasBackend(null);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 3000);
    fetch('/api/health', { signal: controller.signal, cache: 'no-store' })
      .then((res) => setHasBackend(res.ok))
      .catch(() => setHasBackend(false))
      .finally(() => window.clearTimeout(timeoutId));
  }, [isOnline]);

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
    console.log('handleSearch 被調用，輸入:', input);
    try {
      handleStop();
      setState(ReaderState.FETCHING);
      setError(null);
      console.log('開始調用 fetchNovelContent');
      const data = await fetchNovelContent(input);
      console.log('fetchNovelContent 返回:', {
        title: data.title,
        sourceUrl: data.sourceUrl,
        nextChapterUrl: data.nextChapterUrl,
        prevChapterUrl: data.prevChapterUrl,
        chaptersCount: data.chapters?.length || 0,
        contentLength: data.content?.length
      });
      setNovel(data);
      saveReadingProgress(0);
      setShowSearch(false); // 成功載入後隱藏搜尋區域
      setState(ReaderState.IDLE);
      const el = mainRef.current;
      if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      console.error('handleSearch 錯誤:', err);
      setError(err.message || "無法處理網址。請檢查網址是否正確。");
      setState(ReaderState.ERROR);
    }
  };

  const handleNextChapter = () => {
    if (novel?.nextChapterUrl) {
      // 如果有下一章链接，直接跳转
      handleSearch(novel.nextChapterUrl);
    } else if (novel?.sourceUrl) {
      // 如果没有下一章链接，打开原页面
      const url = getSafeOpenUrl(novel.sourceUrl);
      if (url) window.open(url, '_blank');
    }
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

  const handleWebFetch = async (overrideUrl?: string): Promise<boolean> => {
    const url = normalizeUrl(overrideUrl ?? webUrl);
    if (!url) {
      setWebError('請輸入正確的網址');
      return false;
    }
    setWebError(null);
    setWebLoading(true);
    try {
      const res = await fetch('/api/fetch-novel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (res.status === 404) {
        setHasBackend(false);
        throw new Error('未偵測到後端服務，無法抓取網址內容');
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || '抓取失敗，請改為直接貼上文字');
      }
      setWebTitle(data.title || '');
      setWebText(data.content || '');
      setWebUrl(url);
      lastFetchedUrlRef.current = url;
      if (data.title || data.content || data.nextChapterUrl || data.prevChapterUrl || data.chapters) {
        setNovel({
          title: data.title || '',
          content: data.content || '',
          sourceUrl: url,
          nextChapterUrl: data.nextChapterUrl,
          prevChapterUrl: data.prevChapterUrl,
          chapters: data.chapters
        });
      }
      if (!data.content) {
        setWebError('無法取得內容，可改為直接貼上文字');
      }
      return true;
    } catch (err) {
      console.error('handleWebFetch 錯誤:', err);
      const msg =
        err instanceof Error
          ? err.message
          : '抓取失敗，請改為直接貼上文字';
      setWebError(msg || '抓取失敗，請改為直接貼上文字');
      return false;
    } finally {
      setWebLoading(false);
    }
  };

  const tryAutoNext = async (reason: 'scroll' | 'tts') => {
    if (!autoNextEnabled) return;
    if (isEditingText) return;
    if (webLoading) return;
    const nextUrl = novel?.nextChapterUrl;
    if (!nextUrl) return;

    const fromKey = novel?.sourceUrl ?? webUrl ?? '';
    const now = Date.now();
    if (autoNextInFlightRef.current) return;
    if (fromKey && lastAutoNextFromRef.current === fromKey && now - lastAutoNextAtRef.current < 4000) return;

    // 朗讀結束觸發翻章：下一章載入後要自動續播
    if (reason === 'tts') {
      pendingAutoPlayAfterFetchRef.current = true;
    }

    autoNextInFlightRef.current = true;
    lastAutoNextFromRef.current = fromKey;
    lastAutoNextAtRef.current = now;
    try {
      const ok = await handleWebFetch(nextUrl);
      if (ok) {
        const el = mainRef.current;
        if (el) el.scrollTo({ top: 0, behavior: reason === 'scroll' ? 'auto' : 'smooth' });
        else window.scrollTo({ top: 0, behavior: reason === 'scroll' ? 'auto' : 'smooth' });
      }
      if (!ok && reason === 'tts') pendingAutoPlayAfterFetchRef.current = false;
    } finally {
      autoNextInFlightRef.current = false;
    }
  };

  const checkScrollForAutoNext = () => {
    if (!autoNextEnabled) return;
    if (isEditingText) return;
    const el = mainRef.current;
    if (!el) return;
    const threshold = 160;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      void tryAutoNext('scroll');
    }
  };

  const handleMainScroll = () => {
    if (!autoNextEnabled) return;
    if (isEditingText) return;
    if (scrollCheckRafRef.current != null) return;
    scrollCheckRafRef.current = window.requestAnimationFrame(() => {
      scrollCheckRafRef.current = null;
      checkScrollForAutoNext();
    });
  };

  useEffect(() => {
    return () => {
      if (scrollCheckRafRef.current != null) cancelAnimationFrame(scrollCheckRafRef.current);
    };
  }, []);

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

  const handleWebPlayPause = async () => {
    // 若正在以 AI 朗讀：暫停/繼續 AudioContext
    if (webAiPlayingRef.current && audioContextRef.current) {
      if (webIsSpeaking && !webIsPaused) {
        await audioContextRef.current.suspend();
        setWebIsPaused(true);
      } else if (webIsPaused) {
        await audioContextRef.current.resume();
        setWebIsPaused(false);
      }
      return;
    }

    if (typeof speechSynthesis === 'undefined' && !useAiReading) {
      setWebError('此瀏覽器不支援語音朗讀');
      return;
    }
    if (webIsSpeaking && !webIsPaused && !webAiPlayingRef.current) {
      speechSynthesis.pause();
      webSpeechPausedElapsedRef.current = webSpeechElapsed;
      setWebIsPaused(true);
      return;
    }
    if (webIsSpeaking && webIsPaused && !webAiPlayingRef.current) {
      speechSynthesis.resume();
      webSpeechStartTimeRef.current = Date.now() - webSpeechPausedElapsedRef.current * 1000;
      setWebIsPaused(false);
      return;
    }
    const trimmedText = webText.trim();
    if (!trimmedText) {
      setWebError('請先貼上文字或抓取內容');
      return;
    }
    setWebError(null);

    // 使用 AI（Gemini）朗讀：分段合成、依序播放
    if (useAiReading) {
      handleWebStop();
      const segments = splitTextForTTS(trimmedText, 1200);
      if (segments.length === 0) {
        setWebError('沒有可朗讀的內容');
        return;
      }
      setWebAiLoading(true);
      const ctx = initAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      if (sourceRef.current) sourceRef.current.stop();
      const apiKeyArg = geminiApiKey.trim() || undefined;
      const playNextSegment = async (index: number) => {
        if (!webAiPlayingRef.current) return;
        if (index >= segments.length) {
          webAiPlayingRef.current = false;
          setWebIsSpeaking(false);
          setWebIsPaused(false);
          setWebSpeechElapsed(0);
          setWebAiLoading(false);
          void tryAutoNext('tts');
          return;
        }
        try {
          const chunk = segments[index];
          const base64Audio = await generateSpeech(chunk, 'Kore', apiKeyArg);
          if (!webAiPlayingRef.current) return;
          const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
          if (!webAiPlayingRef.current) return;
          const gainNode = ctx.createGain();
          gainNode.gain.value = volume;
          gainNodeRef.current = gainNode;
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = webRate;
          source.connect(gainNode);
          gainNode.connect(ctx.destination);
          source.onended = () => {
            if (!webAiPlayingRef.current) return;
            playNextSegment(index + 1);
          };
          source.start(0);
          sourceRef.current = source;
          if (index === 0) {
            webAiPlayingRef.current = true;
            setWebIsSpeaking(true);
            setWebIsPaused(false);
            {
              const totalSec = audioBuffer.duration * segments.length;
              setWebSpeechTotalSec(totalSec);
              webEstimatedDurationRef.current = totalSec;
            }
            setWebSpeechElapsed(0);
            webSpeechStartTimeRef.current = Date.now();
            setWebAiLoading(false);
          }
        } catch (err: any) {
          const msg = err?.message ?? err?.toString?.() ?? '';
          console.error('AI 朗讀錯誤:', err);
          webAiPlayingRef.current = false;
          setWebIsSpeaking(false);
          setWebIsPaused(false);
          setWebAiLoading(false);
          if (msg.includes('API') || msg.includes('401') || msg.includes('403') || msg.includes('API key') || msg.includes('quota') || msg.includes('INVALID_ARGUMENT')) {
            setWebError('AI 朗讀失敗：請在選單設定有效的 Gemini API Key，或檢查 API 配額。');
          } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')) {
            setWebError('AI 朗讀失敗：網路錯誤，請檢查連線後再試。');
          } else {
            setWebError(msg ? `AI 朗讀失敗：${msg}` : 'AI 朗讀失敗，請稍後再試。');
          }
        }
      };
      playNextSegment(0);
      return;
    }

    // 瀏覽器語音朗讀
    const speakText = (webText || '').replace(/\r\n/g, '\n');
    // 回退用估算：字速保守一些，避免高亮一路跑在前面
    const charsPerSecond = 4.4;
    const estimatedSec = Math.max((speakText.length / charsPerSecond) / webRate, 1);
    webEstimatedDurationRef.current = estimatedSec;
    setWebSpeechTotalSec(estimatedSec);
    webSpeechStartTimeRef.current = Date.now();
    webSpeechPausedElapsedRef.current = 0;
    setWebSpeechElapsed(0);
    webSpeechCharIndexRef.current = 0;
    setWebSpeechCharIndex(0);
    const utterance = new SpeechSynthesisUtterance(speakText);
    utterance.rate = webRate;
    if (webVoice) {
      const voice = webVoices.find(v => v.name === webVoice);
      if (voice) utterance.voice = voice;
    }
    utterance.onend = () => {
      setWebIsSpeaking(false);
      setWebIsPaused(false);
      webUtteranceRef.current = null;
      setWebSpeechElapsed(0);
      webSpeechCharIndexRef.current = 0;
      setWebSpeechCharIndex(0);
      void tryAutoNext('tts');
    };
    // 有支援的瀏覽器會提供 charIndex，可用來精準同步高亮
    (utterance as any).onboundary = (e: any) => {
      if (e && typeof e.charIndex === 'number') {
        webSpeechCharIndexRef.current = e.charIndex;
      }
    };
    utterance.onerror = () => {
      setWebError('朗讀失敗，請稍後再試');
      setWebIsSpeaking(false);
      setWebIsPaused(false);
      webUtteranceRef.current = null;
      setWebSpeechElapsed(0);
      webSpeechCharIndexRef.current = 0;
      setWebSpeechCharIndex(0);
    };
    webUtteranceRef.current = utterance;
    setWebIsSpeaking(true);
    setWebIsPaused(false);
    speechSynthesis.speak(utterance);
  };

  const handleWebStop = () => {
    if (webAiPlayingRef.current && sourceRef.current && audioContextRef.current) {
      try {
        sourceRef.current.stop();
      } catch {}
      webAiPlayingRef.current = false;
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setWebIsSpeaking(false);
    setWebIsPaused(false);
    webUtteranceRef.current = null;
    setWebSpeechElapsed(0);
  };

  // 若使用者在「正在播放」時翻頁，抓取完成後自動播放新章節
  useEffect(() => {
    if (!pendingAutoPlayAfterFetchRef.current) return;
    if (isEditingText) return;
    if (webLoading) return;
    if (webIsSpeaking || webIsPaused) return;
    if (!webText.trim()) return;
    pendingAutoPlayAfterFetchRef.current = false;
    void handleWebPlayPause();
  }, [webText, webLoading, webIsSpeaking, webIsPaused, isEditingText]);

  // Web 朗讀進度：用於跟讀時當前行高亮
  useEffect(() => {
    if (!webIsSpeaking || webIsPaused) return;
    const tick = () => {
      const elapsed = (Date.now() - webSpeechStartTimeRef.current) / 1000;
      const total = webSpeechTotalSec || webEstimatedDurationRef.current || 1;
      const value = Math.min(elapsed, total);
      setWebSpeechElapsed(value);
      // 若是瀏覽器語音（非 AI），用 boundary charIndex 讓高亮更精準
      if (!webAiPlayingRef.current) {
        setWebSpeechCharIndex(webSpeechCharIndexRef.current);
      }
      webSpeechTickRef.current = requestAnimationFrame(tick);
    };
    webSpeechTickRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(webSpeechTickRef.current);
  }, [webIsSpeaking, webIsPaused]);

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

  const webParagraphData = useMemo(() => {
    const normalized = (webText || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    let cursor = 0;
    const paragraphs = lines.map((raw, idx) => {
      const text = raw;
      const isEmpty = text.trim().length === 0;
      const start = cursor;
      // 統一計算每行佔用的字元區間（包含換行），以便與 speechSynthesis 的 charIndex 對齊
      // 這裡用 normalized（包含空行）來對齊 utterance 的文字。
      const hasNewline = idx < lines.length - 1;
      const end = cursor + text.length + (hasNewline ? 1 : 0);
      cursor = end;
      return { idx, text, isEmpty, start, end };
    });
    return { paragraphs, totalChars: cursor };
  }, [webText]);

  // 內容變更時清空 ref map，避免舊節點殘留
  useEffect(() => {
    paragraphElsRef.current.clear();
  }, [webText]);

  const getParagraphIdxClosestToCenter = () => {
    const el = mainRef.current;
    if (!el) return null;
    const centerY = el.getBoundingClientRect().top + el.clientHeight / 2;
    let bestIdx: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [idx, pEl] of paragraphElsRef.current.entries()) {
      const rect = pEl.getBoundingClientRect();
      const pCenter = rect.top + rect.height / 2;
      const dist = Math.abs(pCenter - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }
    return bestIdx;
  };

  const addBookmark = () => {
    const paragraphIdx =
      activeParagraphIdx ?? getParagraphIdxClosestToCenter() ?? 0;
    const para = webParagraphData.paragraphs.find(p => p.idx === paragraphIdx);
    const snippetRaw = para?.text ?? '';
    const snippet = snippetRaw.trim().slice(0, 80);
    const sourceUrl = novel?.sourceUrl ?? lastFetchedUrlRef.current ?? webUrl ?? '';
    const title = (webTitle || novel?.title || '未命名章節').trim();
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const item: BookmarkItem = {
      id,
      createdAt: Date.now(),
      sourceUrl,
      title,
      paragraphIdx,
      snippet: snippet || '(空白段落)'
    };
    setBookmarks(prev => [item, ...prev]);
    setBookmarkToast('已加入畫籤');
    window.setTimeout(() => setBookmarkToast(null), 1600);
  };

  const deleteBookmark = (id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
  };

  const clearBookmarks = () => {
    setBookmarks([]);
  };

  const jumpToBookmark = async (bm: BookmarkItem) => {
    setIsBookmarksOpen(false);
    if (bm.sourceUrl && (novel?.sourceUrl || lastFetchedUrlRef.current || webUrl) && bm.sourceUrl !== (novel?.sourceUrl ?? lastFetchedUrlRef.current ?? webUrl)) {
      pendingScrollToParagraphRef.current = bm.paragraphIdx;
      await handleWebFetch(bm.sourceUrl);
      return;
    }
    const el = paragraphElsRef.current.get(bm.paragraphIdx);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  useEffect(() => {
    const idx = pendingScrollToParagraphRef.current;
    if (idx == null) return;
    // 等段落節點建立後再捲動
    const el = paragraphElsRef.current.get(idx);
    if (!el) return;
    pendingScrollToParagraphRef.current = null;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [webText]);

  const activeParagraphIdx = useMemo(() => {
    if (!centerFollowEnabled) return null;
    if (!webIsSpeaking || webIsPaused) return null;
    if (webParagraphData.totalChars <= 0) return null;

    // 若為瀏覽器語音且支援 onboundary，優先使用 charIndex 做精準對齊
    const hasBoundaryCharIndex = !webAiPlayingRef.current && webSpeechCharIndex > 0;
    let targetChar: number;
    if (hasBoundaryCharIndex) {
      targetChar = Math.min(Math.max(webSpeechCharIndex, 0), webParagraphData.totalChars - 1);
    } else {
      const total = webSpeechTotalSec || webEstimatedDurationRef.current;
      if (!total || total <= 0) return null;
      const ratio = Math.min(Math.max(webSpeechElapsed / total, 0), 0.999999);
      targetChar = Math.floor(ratio * webParagraphData.totalChars);
    }
    let lastNonEmpty: number | null = null;
    for (const p of webParagraphData.paragraphs) {
      if (p.isEmpty) continue;
      lastNonEmpty = p.idx;
      if (targetChar >= p.start && targetChar < p.end) return p.idx;
    }
    return lastNonEmpty;
  }, [
    centerFollowEnabled,
    webIsSpeaking,
    webIsPaused,
    webSpeechElapsed,
    webSpeechTotalSec,
    webSpeechCharIndex,
    webParagraphData
  ]);

  useEffect(() => {
    if (activeParagraphIdx == null) return;
    const el = paragraphElsRef.current.get(activeParagraphIdx);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeParagraphIdx]);

  const getThemeClass = () => {
    switch(theme) {
      case 'sepia': return 'bg-[#f2e6cf] text-[#4a3826] selection:bg-[#8b6f47]/30';
      case 'slate': return 'bg-[#1e293b] text-slate-200 selection:bg-indigo-500/30';
      default: return 'bg-[#0b0f1a] text-slate-300 selection:bg-indigo-500/30';
    }
  };

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${getThemeClass()}`}>

      <Header onToggleMenu={() => setIsMenuOpen(true)} />
      
      <Sidebar 
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenBrowse={() => setIsBrowseOpen(true)}
        onOpenLibrary={() => setIsBrowseOpen(true)}
        onNewSearch={() => setShowSearch(true)}
        onOpenUrlModal={() => { setWebUrl(''); setWebError(null); setIsUrlModalOpen(true); setIsMenuOpen(false); }}
        currentNovelTitle={novel?.title ?? webTitle}
        webRate={webRate}
        setWebRate={setWebRate}
        webVoice={webVoice}
        setWebVoice={setWebVoice}
        webVoices={webVoices}
        geminiApiKey={geminiApiKey}
        setGeminiApiKey={setGeminiApiKey}
        useAiReading={useAiReading}
        setUseAiReading={setUseAiReading}
      />

      {showResumeToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] bg-indigo-600 text-white px-5 py-2.5 rounded-full shadow-2xl animate-fade-in-up text-sm font-bold flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          已自動恢復上次閱讀進度
        </div>
      )}

      {webError && (
        <div className="mx-4 mt-4 mb-0 rounded-2xl bg-red-900/30 border border-red-500/40 px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 flex-shrink-0 mt-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          </span>
          <p className="text-sm text-red-200 flex-1">{webError}</p>
          <button
            type="button"
            onClick={() => setWebError(null)}
            className="text-red-400 hover:text-red-300 flex-shrink-0 p-1"
            aria-label="關閉"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      )}

      <main
        ref={(el) => { mainRef.current = el; }}
        onScroll={handleMainScroll}
        className={`flex-1 overflow-y-auto px-4 md:px-8 pb-32 ${centerFollowEnabled && !isEditingText ? 'snap-y snap-proximity' : ''}`}
      >

       <div className="w-full pt-6 md:pt-10">

            <div className="space-y-6 pb-28">
              {!isOnline && (
                <div className="bg-orange-500/10 border border-orange-500/30 text-orange-300 text-xs rounded-2xl px-4 py-3">
                  目前離線：無法抓取網址內容，但仍可貼上文字朗讀。
                </div>
              )}

                            {/* 章節目錄（可摺疊） */}
              {novel?.chapters && novel.chapters.length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-sm text-slate-300 font-bold">章節目錄 ({novel.chapters.length} 章)</div>
                    <button
                      type="button"
                      onClick={() => setShowWebChapters(!showWebChapters)}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                    >
                      {showWebChapters ? '隱藏' : '顯示'}
                    </button>
                  </div>
                  {showWebChapters && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
                      {novel.chapters.map((chapter, index) => {
                        const isCurrentChapter = chapter.url === novel.sourceUrl;
                        return (
                          <button
                            key={index}
                            type="button"
                            onClick={() => handleWebFetch(chapter.url)}
                            className={`px-4 py-2 rounded-lg text-sm text-left transition-all ${
                              isCurrentChapter
                                ? 'bg-indigo-600 text-white font-bold'
                                : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white'
                            }`}
                            title={chapter.url}
                          >
                            <div className="truncate">{chapter.title || `第 ${index + 1} 章`}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              
              {/* 小說標題（與小說閱讀方式一致） */}
              {(webTitle || novel?.title) && (
                <header className="mb-6 text-center">
                 <h2 className="text-3xl md:text-5xl font-bold text-white serif-font tracking-tight">
                    {webTitle || novel?.title || '小說'}
                  </h2>
                  <div className="w-16 h-1 bg-indigo-500/30 mx-auto rounded-full mt-4" />
                </header>
              )}
              
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                  {isEditingText ? '編輯模式' : '閱讀模式'}
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingText(v => !v)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-200 transition-colors"
                >
                  {isEditingText ? '完成' : '編輯'}
                </button>
              </div>

              {isEditingText ? (
                <textarea
                  value={webText}
                  onChange={(e) => setWebText(e.target.value)}
                  style={{ fontSize: `${fontSize}px` }}
                  className="w-full min-h-[60vh] rounded-2xl bg-white/5 border border-white/10 p-4 whitespace-pre-wrap break-words leading-relaxed outline-none"
                  placeholder="貼上文字或抓取內容後可在此編輯"
                />
              ) : (
                <div
                  style={{ fontSize: `${fontSize}px` }}
                  className="w-full break-words leading-relaxed"
                >
                  <div className={`${centerFollowEnabled ? 'pt-3 pb-[40vh]' : 'py-3'}`}>
                    {webParagraphData.paragraphs.map((p) => {
                      if (p.isEmpty) {
                        return <div key={p.idx} className="h-4" aria-hidden="true" />;
                      }
                      const isActive = activeParagraphIdx === p.idx && webIsSpeaking && !webIsPaused;
                      return (
                        <p
                          key={p.idx}
                          ref={(el) => {
                            if (el) paragraphElsRef.current.set(p.idx, el);
                            else paragraphElsRef.current.delete(p.idx);
                          }}
                          data-paragraph-idx={p.idx}
                          className={`whitespace-pre-wrap mb-4 px-2 py-1 rounded-xl transition-colors snap-center ${
                            isActive ? 'bg-indigo-500/10 ring-1 ring-indigo-500/20' : ''
                          }`}
                        >
                          {p.text}
                        </p>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
        </div>
      </main>

      {/* 固定底部列：上一頁、播放/暫停、停止、下一頁，永遠顯示 */}
      <div className="fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 sm:gap-4 px-2 py-4 bg-slate-900/95 border-t border-white/10 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.4)] safe-area-pb">
        <button
          type="button"
          onClick={() => novel?.prevChapterUrl && handleWebFetch(novel.prevChapterUrl)}
          disabled={!novel?.prevChapterUrl}
          className="flex-shrink-0 w-12 h-12 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-slate-300 transition-colors"
          title="上一頁"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <button
          type="button"
          onClick={handleWebPlayPause}
          disabled={webAiLoading}
          className="flex-shrink-0 w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 flex items-center justify-center text-white shadow-lg transition-colors"
          title={webAiLoading ? 'AI 產生中…' : webIsSpeaking && !webIsPaused ? '暫停' : webIsPaused ? '繼續' : '播放'}
        >
          {webAiLoading ? (
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.22-8.6" strokeLinecap="round"/></svg>
          ) : webIsSpeaking && !webIsPaused ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
        <button
          type="button"
          onClick={handleWebStop}
          className="flex-shrink-0 w-12 h-12 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-300 transition-colors"
          title="停止"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        </button>
        <button
          type="button"
          onClick={addBookmark}
          disabled={!webText.trim()}
          className="flex-shrink-0 w-12 h-12 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-slate-300 transition-colors"
          title="加入畫籤"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setIsBookmarksOpen(true)}
          disabled={bookmarks.length === 0}
          className="flex-shrink-0 w-12 h-12 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-slate-300 transition-colors"
          title="畫籤清單"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 6h13"/>
            <path d="M8 12h13"/>
            <path d="M8 18h13"/>
            <path d="M3 6h.01"/>
            <path d="M3 12h.01"/>
            <path d="M3 18h.01"/>
          </svg>
        </button>
        <button
          type="button"
          onClick={() => {
            const nextUrl = novel?.nextChapterUrl;
            if (!nextUrl) return;
            const wasPlaying = webIsSpeaking && !webIsPaused;
            handleWebStop();
            pendingAutoPlayAfterFetchRef.current = wasPlaying;
            void handleWebFetch(nextUrl).then((ok) => {
              if (!ok) pendingAutoPlayAfterFetchRef.current = false;
              if (ok) {
                const el = mainRef.current;
                if (el) el.scrollTo({ top: 0, behavior: 'auto' });
              }
            });
          }}
          disabled={!novel?.nextChapterUrl}
          className="flex-shrink-0 w-12 h-12 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-slate-300 transition-colors"
          title="下一頁"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>

      {bookmarkToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[120] bg-slate-900/95 border border-white/10 text-slate-100 px-4 py-2 rounded-full text-sm font-bold shadow-2xl backdrop-blur-md">
          {bookmarkToast}
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
              <div><label className="block text-sm font-bold text-slate-400 mb-3 uppercase tracking-widest">小說內容字體大小 ({fontSize}px)</label><input type="range" min="14" max="32" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" /></div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">閱讀行為</div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={centerFollowEnabled}
                    onChange={(e) => setCenterFollowEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-slate-300">跟讀置中（段落置中）</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoNextEnabled}
                    onChange={(e) => setAutoNextEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-slate-300">自動下一章（滾到底/朗讀結束）</span>
                </label>
              </div>
<div>
  <label className="block text-sm font-bold text-slate-400 mb-4 uppercase tracking-widest">
    閱讀主題
  </label>

  <div className="grid grid-cols-3 gap-3">
    {['dark', 'sepia', 'slate'].map(t => {
      const isActive = theme === t;

      const activeStyle =
        t === 'sepia'
          ? 'border-[#8b6f47] bg-[#8b6f47]/10 text-[#5b4636] shadow-lg shadow-[#8b6f47]/20'
          : t === 'slate'
          ? 'border-slate-400 bg-slate-500/10 text-slate-100 shadow-lg shadow-slate-500/20'
          : 'border-indigo-500 bg-indigo-500/10 text-white shadow-lg shadow-indigo-500/20';

      return (
        <button
          key={t}
          onClick={() => setTheme(t as any)}
          className={`
            py-4 rounded-2xl border transition-all font-bold
            ${isActive
              ? activeStyle
              : 'border-white/5 bg-white/5 text-slate-500 hover:bg-white/10'}
          `}
        >
          {t === 'dark' ? '深邃黑' : t === 'sepia' ? '羊皮紙' : '岩板灰'}
        </button>
      );
    })}
  </div>
</div>

            </div>
            <button onClick={() => setIsSettingsOpen(false)} className="w-full mt-10 py-5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl transition-all shadow-xl shadow-indigo-600/20">確認儲存</button>
          </div>
        </div>
      )}

      {/* Bookmarks Modal */}
      {isBookmarksOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsBookmarksOpen(false)}>
          <div className="bg-slate-900 border border-white/10 w-full max-w-lg rounded-[2rem] p-6 md:p-8 shadow-2xl text-slate-100 animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">畫籤</h2>
                <p className="text-slate-400 text-sm mt-1">點擊畫籤即可跳回閱讀位置</p>
              </div>
              <button type="button" onClick={() => setIsBookmarksOpen(false)} className="text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/5">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 mb-4">
              <button
                type="button"
                onClick={addBookmark}
                disabled={!webText.trim()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm"
              >
                新增目前畫籤
              </button>
              <button
                type="button"
                onClick={clearBookmarks}
                disabled={bookmarks.length === 0}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 text-slate-200 font-bold text-sm"
              >
                清空
              </button>
            </div>

            {bookmarks.length === 0 ? (
              <div className="p-8 rounded-2xl bg-white/5 border border-white/10 text-center text-slate-400">
                尚無畫籤。閱讀時點底部「加入畫籤」即可建立。
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {bookmarks.map(bm => (
                  <div key={bm.id} className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                    <button type="button" onClick={() => void jumpToBookmark(bm)} className="w-full text-left">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-100 truncate">{bm.title || '未命名章節'}</div>
                          <div className="text-xs text-slate-400 mt-1 truncate">
                            {bm.snippet}
                          </div>
                        </div>
                        <div className="text-[10px] text-slate-500 font-bold whitespace-nowrap">
                          #{bm.paragraphIdx}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center justify-between mt-3">
                      <div className="text-[10px] text-slate-500 font-mono truncate">
                        {bm.sourceUrl || '(無網址)'}
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteBookmark(bm.id)}
                        className="text-xs font-bold text-red-300 hover:text-red-200 px-3 py-1 rounded-lg hover:bg-red-500/10"
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

      {/* Browse Modal */}
      {isBrowseOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 w-full max-w-2xl rounded-[2rem] p-8 shadow-2xl text-slate-100 animate-fade-in-up">
            <div className="flex justify-between items-center mb-8"><div><h2 className="text-2xl font-bold">瀏覽書源</h2><p className="text-slate-400 text-sm mt-1">開啟連結搜尋後，將網址貼回首頁輸入框。</p></div><button onClick={() => setIsBrowseOpen(false)} className="text-slate-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[ { name: '稷下書院', url: 'https://www.novel543.com', c: 'bg-orange-500' }, { name: '黃金屋中文', url: 'https://tw.hjwzw.com/index.html', c: 'bg-amber-600' }, { name: '纵横中文网', url: 'https://www.zongheng.com', c: 'bg-emerald-600' } ].map(site => (
                <a key={site.name} href={site.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all group">
                  <div className={`w-12 h-12 rounded-xl ${site.c} flex items-center justify-center text-white font-bold shadow-lg`}>{site.name[0]}</div>
                  <div><h3 className="font-bold group-hover:text-indigo-400 transition-colors">{site.name}</h3><p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">前往官方網站</p></div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 網址抓取 Modal */}
      {isUrlModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsUrlModalOpen(false)}>
          <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-[2rem] p-8 shadow-2xl text-slate-100 animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">貼上網址</h2>
              <button type="button" onClick={() => setIsUrlModalOpen(false)} className="text-slate-400 hover:text-white p-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <input
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
              placeholder="貼上網址（例如 https://example.com）"
              className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 mb-4"
            />
            <button
              type="button"
              onClick={async () => {
                const ok = await handleWebFetch();
                if (ok) setIsUrlModalOpen(false);
              }}
              disabled={webLoading}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50"
            >
              {webLoading ? '抓取中...' : '抓取內容'}
            </button>
            {hasBackend === false && (
              <p className="mt-3 text-xs text-slate-500">未偵測到後端服務，請改用貼文字朗讀。</p>
            )}
            {webError && (
              <p className="mt-3 text-xs text-orange-400">{webError}</p>
            )}
          </div>
        </div>
      )}

      {theme === 'dark' && (<><div className="fixed -top-24 -left-24 w-96 h-96 bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none -z-10"></div><div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none -z-10"></div></>)}
    </div>
  );
};

export default App;
