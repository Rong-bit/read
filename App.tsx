
import React, { useState, useRef, useEffect } from 'react';
import { NovelContent, ReaderState } from './types.ts';
import { fetchNovelContent, generateSpeech, TtsQuotaExceededError } from './services/geminiService.ts';
import {
  getRemainingTtsChars,
  TTS_MAX_CHARS_PER_SEGMENT,
  TTS_MONTHLY_CHAR_LIMIT,
  TTS_QUOTA_UPDATE_EVENT,
} from './utils/ttsQuota.ts';
import { decode, decodeAudioData } from './utils/audioUtils.ts';
import { getSafeOpenUrl } from './utils/urlUtils.ts';
import * as OpenCC from 'opencc-js';

const STORAGE_KEY_SETTINGS = 'gemini_reader_settings';
const STORAGE_KEY_PROGRESS = 'gemini_reader_progress';
const STORAGE_KEY_WEB_RATE = 'web_reader_rate';
const STORAGE_KEY_WEB_VOICE = 'web_reader_voice';
const STORAGE_KEY_USE_AI_READING = 'gemini_reader_use_ai';
const STORAGE_KEY_AUTO_NEXT = 'gemini_reader_auto_next';
const STORAGE_KEY_DEFAULT_RATE_MIGRATION = 'gemini_reader_default_rate_v2';
const SPEED_PRESETS = [0.75, 1, 1.25, 1.5] as const;
const AI_TAIWAN_VOICE_OPTIONS = [
  { id: 'Aoede', name: '女聲（標準）' },
  { id: 'Kore', name: '男聲 A（標準）' },
  { id: 'Puck', name: '男聲 B（標準）' },
] as const;

const AI_HUAYU_VOICE_OPTIONS = [
  { id: 'Fenrir', name: '女聲（標準）' },
  { id: 'Charon', name: '男聲（標準）' },
] as const;

const VOICE_SELECT_CLASS =
  'w-full bg-slate-700 text-slate-100 text-sm rounded-md border border-white/20 px-2 py-2 focus:outline-none focus:border-indigo-400';

const isChineseSystemVoice = (v: SpeechSynthesisVoice): boolean => {
  const lang = (v.lang || '').toLowerCase();
  const name = v.name || '';
  return lang.startsWith('zh')
    || /華語|中文|國語|台灣語|台湾语|台語|臺語|粤|粵|台湾|臺灣|taiwan|chinese|mandarin|cantonese|hokkien|minnan/i.test(name);
};

const isTaiwanSystemVoice = (v: SpeechSynthesisVoice): boolean => {
  const lang = (v.lang || '').toLowerCase();
  const name = v.name || '';
  return lang === 'zh-tw' || lang.startsWith('zh-tw')
    || /台灣語|台湾语|台灣|臺灣|taiwan|traditional.*taiwan|國語.*台灣/i.test(name);
};

const isHuayuSystemVoice = (v: SpeechSynthesisVoice): boolean => {
  if (isTaiwanSystemVoice(v)) return false;
  const lang = (v.lang || '').toLowerCase();
  const name = v.name || '';
  return lang === 'zh-cn' || lang.startsWith('zh-cn')
    || /華語|华语|普通话|普通話|国语|國語(?!.*台)|mandarin|putong/i.test(name);
};

const sortSystemVoicesForDisplay = (voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] => {
  const taiwan = voices.filter(isTaiwanSystemVoice);
  const huayu = voices.filter(isHuayuSystemVoice);
  const other = voices.filter((v) => !isTaiwanSystemVoice(v) && !isHuayuSystemVoice(v));
  return [...taiwan, ...huayu, ...other];
};

const pickDefaultChineseVoice = (voices: SpeechSynthesisVoice[]): string => {
  if (voices.length === 0) return '';
  const prefer = voices.find((v) => /台灣語/i.test(v.name))
    || voices.find(isTaiwanSystemVoice)
    || voices.find((v) => /華語/i.test(v.name))
    || voices.find((v) => v.lang.toLowerCase().startsWith('zh-tw'))
    || voices.find((v) => v.lang.toLowerCase().startsWith('zh'))
    || voices[0];
  return prefer?.name || '';
};
type BookmarkData = {
  id: string;
  title: string;
  sourceUrl: string;
  scrollTop: number;
  readingCharIndex: number | null;
  lineNumber: number;
  savedAt: number;
};
const s2tConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });

const normalizePlaybackRate = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return SPEED_PRESETS.reduce((closest, current) => (
    Math.abs(current - value) < Math.abs(closest - value) ? current : closest
  ), SPEED_PRESETS[0]);
};

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
      {title || '尚未載入章節'}
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
  onConvertToTraditional?: () => void;
  onOpenUrlModal?: () => void;
  currentNovelTitle?: string;
  webRate?: number;
  setWebRate?: (v: number) => void;
  voice?: string;
  setVoice?: (v: string) => void;
  webVoice?: string;
  setWebVoice?: (v: string) => void;
  webVoices?: SpeechSynthesisVoice[];
  useAiReading?: boolean;
  setUseAiReading?: (v: boolean) => void;
  autoNextChapter?: boolean;
  setAutoNextChapter?: (v: boolean) => void;
  onAutoNextToggle?: (enabled: boolean) => void;
};

const Sidebar: React.FC<LocalSidebarProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onOpenBrowse,
  onConvertToTraditional,
  onOpenUrlModal,
  currentNovelTitle,
  webRate = 1,
  setWebRate,
  voice = 'Aoede',
  setVoice,
  useAiReading = true,
  setUseAiReading,
  webVoice = '',
  setWebVoice,
  webVoices = [],
  autoNextChapter = true,
  setAutoNextChapter,
  onAutoNextToggle
}) => {
  const chineseSystemVoices = webVoices.filter(isChineseSystemVoice);
  const systemVoices = sortSystemVoicesForDisplay(
    chineseSystemVoices.length > 0 ? chineseSystemVoices : webVoices
  );

  return (
  <div className={`fixed top-0 right-0 h-full w-[300px] bg-slate-900/95 border-l border-white/15 z-[160] transition-transform duration-500 ease-out shadow-2xl flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
    <div className="p-4 border-b border-white/15 flex items-center justify-between">
      <span className="font-bold text-slate-100 text-base">選單</span>
      <button onClick={onClose} className="text-slate-200 text-sm font-semibold px-2 py-1 rounded bg-slate-700/60 hover:bg-slate-600/70">關閉</button>
    </div>
    <div className="p-4 space-y-3">
      {currentNovelTitle ? <div className="text-sm text-slate-100/95 truncate font-medium">{currentNovelTitle}</div> : null}
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onOpenUrlModal?.(); onClose(); }}>網址抓取</button>
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onConvertToTraditional?.(); onClose(); }}>簡轉繁</button>
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onOpenBrowse(); onClose(); }}>瀏覽書源</button>
      <button className="w-full text-left p-3.5 bg-slate-600 text-white rounded-lg text-base font-bold border border-white/25 hover:bg-slate-500" onClick={() => { onOpenSettings(); onClose(); }}>閱讀偏好</button>
      <button
        className={`w-full text-left p-3.5 rounded-lg text-base font-bold border ${autoNextChapter ? 'bg-emerald-600 text-white border-emerald-300/40 hover:bg-emerald-500' : 'bg-slate-700 text-slate-100 border-white/25 hover:bg-slate-600'}`}
        onClick={() => {
          const next = !autoNextChapter;
          setAutoNextChapter?.(next);
          onAutoNextToggle?.(next);
        }}
      >
        自動下一章：{autoNextChapter ? '開' : '關'}
      </button>
      <button
        className={`w-full text-left p-3.5 rounded-lg text-base font-bold border ${useAiReading ? 'bg-indigo-600 text-white border-indigo-300/40 hover:bg-indigo-500' : 'bg-slate-700 text-slate-100 border-white/25 hover:bg-slate-600'}`}
        onClick={() => setUseAiReading?.(!useAiReading)}
      >
        朗讀模式：{useAiReading ? 'AI（標準語音）' : '系統語音（免費）'}
      </button>
      {useAiReading ? (
        <p className="text-[11px] text-slate-400 leading-relaxed px-1">
          使用 Google 標準語音，每月約 {TTS_MONTHLY_CHAR_LIMIT.toLocaleString()} 字上限；超出後自動改系統語音。建議搭配 Google Cloud 帳單預算提醒。
        </p>
      ) : null}
      {useAiReading ? (
        <div className="rounded-lg border border-white/15 p-3 bg-slate-800/40">
          <div className="text-xs text-slate-300 mb-2">AI 語音</div>
          <select
            value={voice}
            onChange={(e) => setVoice?.(e.target.value)}
            className={VOICE_SELECT_CLASS}
          >
            <optgroup label="台灣">
              {AI_TAIWAN_VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  台灣・{v.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="華語">
              {AI_HUAYU_VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  華語・{v.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      ) : null}
      {!useAiReading ? (
        <div className="rounded-lg border border-white/15 p-3 bg-slate-800/40">
          <div className="text-xs text-slate-300 mb-2">系統語音</div>
          {systemVoices.length > 0 ? (
            <select
              value={webVoice}
              onChange={(e) => setWebVoice?.(e.target.value)}
              className="w-full bg-slate-700 text-slate-100 text-sm rounded-md border border-white/20 px-2 py-2"
            >
              {systemVoices.some(isTaiwanSystemVoice) ? (
                <optgroup label="台灣語音">
                  {systemVoices.filter(isTaiwanSystemVoice).map((v) => (
                    <option key={`tw-${v.name}-${v.lang}`} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {systemVoices.some(isHuayuSystemVoice) ? (
                <optgroup label="華語語音">
                  {systemVoices.filter(isHuayuSystemVoice).map((v) => (
                    <option key={`hy-${v.name}-${v.lang}`} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {systemVoices.some((v) => !isTaiwanSystemVoice(v) && !isHuayuSystemVoice(v)) ? (
                <optgroup label="其他中文語音">
                  {systemVoices.filter((v) => !isTaiwanSystemVoice(v) && !isHuayuSystemVoice(v)).map((v) => (
                    <option key={`zh-${v.name}-${v.lang}`} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          ) : (
            <p className="text-xs text-slate-400">載入語音中…若列表為空，請重新整理頁面。</p>
          )}
        </div>
      ) : null}
      <div className="rounded-lg border border-white/15 p-3 bg-slate-800/40">
        <div className="text-xs text-slate-300 mb-2">播放速度</div>
        <div className="grid grid-cols-4 gap-2">
          {SPEED_PRESETS.map((speed) => (
            <button
              key={speed}
              className={`py-2 rounded-md text-sm font-semibold border ${webRate === speed ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-slate-700 text-slate-100 border-white/20 hover:bg-slate-600'}`}
              onClick={() => setWebRate?.(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  </div>
  );
};

const App: React.FC = () => {
  const [novel, setNovel] = useState<NovelContent | null>(null);
  const [voice, setVoice] = useState('Aoede');
  const [volume, setVolume] = useState(0.8);
  const [playbackRate, setPlaybackRate] = useState(1);
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
  const [webRate, setWebRate] = useState(1);
  const [webError, setWebError] = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(false);
  const [webIsSpeaking, setWebIsSpeaking] = useState(false);
  const [webIsPaused, setWebIsPaused] = useState(false);
  const [webVoices, setWebVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [webVoice, setWebVoice] = useState('');
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<'keyword' | 'url'>('keyword');
  const [useAiReading, setUseAiReading] = useState(false);
  const [ttsRemainingChars, setTtsRemainingChars] = useState(() => getRemainingTtsChars());
  const [autoNextChapter, setAutoNextChapter] = useState(true);
  const [webAiLoading, setWebAiLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkData[]>([]);
  const [isBookmarkListOpen, setIsBookmarkListOpen] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const htmlAudioRef = useRef<HTMLAudioElement | null>(null);
  // 手機瀏覽器需要由「使用者手勢」啟用一次後才可程式化播放。
  // 這裡用單一可重用的 audio 元素，避免每個 segment new Audio() 後被自動播放政策阻擋。
  const unlockedHtmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaUnlockedRef = useRef(false);
  const currentBlobUrlRef = useRef<string | null>(null);
  const aiPlaybackModeRef = useRef<'webaudio' | 'htmlaudio'>('webaudio');
  const toastTimerRef = useRef<number | null>(null);
  const pendingRestoreRef = useRef<BookmarkData | null>(null);
  const webAiPlayingRef = useRef(false);
  const webTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const boundaryTickRef = useRef<number | null>(null);
  const ttsStartAtRef = useRef<number>(0);
  const hasBoundaryEventRef = useRef<boolean>(false);
  const lastAutoScrollAtRef = useRef<number>(0);
  const aiProgressRafRef = useRef<number | null>(null);
  const aiSegmentProgressRef = useRef<{
    ctx: AudioContext;
    startCtxTime: number;
    duration: number;
    bufferDuration: number;
    charStart: number;
    charEnd: number;
  } | null>(null);
  const novelRef = useRef<NovelContent | null>(null);
  const autoAdvanceInFlightRef = useRef(false);
  const shouldAutoplayAfterSearchRef = useRef(false);
  const pendingBrowserSpeechRef = useRef<{ fullText: string; offset: number; text: string } | null>(null);
  const forceStartFromTopRef = useRef(false);
  const suppressOnEndRef = useRef(false);
  const voiceRef = useRef(voice);
  const webRateRef = useRef(webRate);
  const webVoiceRef = useRef(webVoice);
  const webTextRef = useRef(webText);
  const readingCharIndexRef = useRef<number | null>(null);
  const webVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const aiPlaybackStateRef = useRef<{
    fullText: string;
    offset: number;
    segments: Array<{ text: string; start: number; end: number }>;
    segmentIndex: number;
    ctx: AudioContext;
  } | null>(null);
  const playAiSegmentRef = useRef<(index: number) => Promise<void>>(async () => {});
  const systemSpeechEpochRef = useRef(0);
  const aiPlaybackEpochRef = useRef(0);
  const useAiReadingRef = useRef(useAiReading);
  const systemSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemSpeechIdlePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const webIsSpeakingRef = useRef(false);
  const playbackRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => { webRateRef.current = webRate; }, [webRate]);
  useEffect(() => { webVoiceRef.current = webVoice; }, [webVoice]);
  useEffect(() => { webTextRef.current = webText; }, [webText]);
  const getFriendlyError = (raw: string): string => {
    const text = (raw || '').toLowerCase();
    if (text.includes('quota') || text.includes('429') || text.includes('rate limit')) {
      return 'AI 配額或請求頻率已達上限，請稍後重試或改用系統語音。';
    }
    if (text.includes('api key') || text.includes('401') || text.includes('403') || text.includes('unauthorized')) {
      return 'AI 服務授權失敗，請檢查 API 金鑰設定。';
    }
    if (text.includes('網址') || text.includes('url') || text.includes('http')) {
      return raw || '網址格式或內容解析失敗，請更換章節網址再試。';
    }
    if (text.includes('network') || text.includes('failed to fetch') || text.includes('timeout')) {
      return '網路連線不穩，請檢查網路後重試。';
    }
    return raw || '載入失敗，請稍後再試。';
  };
  const normalizeChapterUrl = (targetUrl?: string, baseUrl?: string): string | undefined => {
    const raw = (targetUrl || '').trim();
    if (!raw) return undefined;
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = (baseUrl || '').trim();
    if (!base) return undefined;
    try {
      return new URL(raw, base).toString();
    } catch {
      return undefined;
    }
  };
  const [readingCharIndex, setReadingCharIndex] = useState<number | null>(null);
  const [readingLineViewportY, setReadingLineViewportY] = useState<number | null>(null);
  const [readingLineHeight, setReadingLineHeight] = useState<number>(36);

  useEffect(() => { readingCharIndexRef.current = readingCharIndex; }, [readingCharIndex]);
  useEffect(() => { webVoicesRef.current = webVoices; }, [webVoices]);
  useEffect(() => { webIsSpeakingRef.current = webIsSpeaking; }, [webIsSpeaking]);
  useEffect(() => { useAiReadingRef.current = useAiReading; }, [useAiReading]);

  const clearSystemSpeechTimer = () => {
    if (systemSpeechTimerRef.current != null) {
      window.clearTimeout(systemSpeechTimerRef.current);
      systemSpeechTimerRef.current = null;
    }
  };

  const clearSystemSpeechIdlePoll = () => {
    if (systemSpeechIdlePollRef.current != null) {
      window.clearTimeout(systemSpeechIdlePollRef.current);
      systemSpeechIdlePollRef.current = null;
    }
  };

  const clearAllSystemSpeechSchedules = () => {
    clearSystemSpeechTimer();
    clearSystemSpeechIdlePoll();
    if (playbackRestartTimerRef.current != null) {
      window.clearTimeout(playbackRestartTimerRef.current);
      playbackRestartTimerRef.current = null;
    }
  };

  const waitForSystemSpeechIdle = (epoch: number): Promise<void> => {
    return new Promise((resolve) => {
      const deadline = Date.now() + 2800;
      const poll = () => {
        if (epoch !== systemSpeechEpochRef.current) {
          clearSystemSpeechIdlePoll();
          resolve();
          return;
        }
        const syn = window.speechSynthesis;
        syn.cancel();
        if (!syn.speaking && !syn.pending) {
          clearSystemSpeechIdlePoll();
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          clearSystemSpeechIdlePoll();
          resolve();
          return;
        }
        systemSpeechIdlePollRef.current = window.setTimeout(poll, 45);
      };
      clearSystemSpeechIdlePoll();
      poll();
    });
  };

  const stopCurrentAiSegmentOnly = () => {
    stopAiProgressLoop();
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (htmlAudioRef.current) {
      const audio = htmlAudioRef.current;
      audio.onended = null;
      audio.onerror = null;
      try { audio.pause(); } catch { /* ignore */ }
      // 注意：保留 unlockedHtmlAudioRef.current 不要 destroy，
      // 否則手機需要重新 user gesture 才能再次播放。這裡只清 src 並釋放 blob URL。
      try { audio.removeAttribute('src'); } catch { /* ignore */ }
      try { audio.load(); } catch { /* ignore */ }
      htmlAudioRef.current = null;
    }
    releaseCurrentBlobUrl();
  };

  const stopAiPlaybackOnly = () => {
    aiPlaybackEpochRef.current += 1;
    webAiPlayingRef.current = false;
    aiPlaybackStateRef.current = null;
    stopAiProgressLoop();
    stopCurrentAiSegmentOnly();
    setWebAiLoading(false);
    setWebIsPaused(false);
  };

  const stopSystemSpeechOnly = () => {
    systemSpeechEpochRef.current += 1;
    systemUtteranceRef.current = null;
    clearAllSystemSpeechSchedules();
    suppressOnEndRef.current = true;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (boundaryTickRef.current) {
      window.clearInterval(boundaryTickRef.current);
      boundaryTickRef.current = null;
    }
    setWebIsPaused(false);
  };

  const switchToSystemSpeechAtCurrentPosition = () => {
    stopAiPlaybackOnly();
    const fullText = webTextRef.current;
    if (!fullText.trim()) return;
    const charPos = readingCharIndexRef.current ?? 0;
    const playOffset = Math.max(0, Math.min(charPos, fullText.length));
    speakSystemSpeechAt(fullText, playOffset);
  };

  const applyLivePlaybackRate = () => {
    const rate = webRateRef.current;
    if (htmlAudioRef.current) {
      htmlAudioRef.current.playbackRate = rate;
    }
    if (sourceRef.current) {
      sourceRef.current.playbackRate.value = rate;
    }
    const meta = aiSegmentProgressRef.current;
    if (meta) {
      meta.duration = meta.bufferDuration / Math.max(0.1, rate);
    }
  };

  const restartAiPlaybackAtCurrentPosition = () => {
    const state = aiPlaybackStateRef.current;
    if (!state || !webAiPlayingRef.current) return;
    stopCurrentAiSegmentOnly();
    const charPos = readingCharIndexRef.current ?? state.offset;
    const playOffset = Math.max(0, Math.min(charPos, state.fullText.length));
    const text = state.fullText.slice(playOffset);
    state.offset = playOffset;
    state.segments = splitTextForTTSWithRanges(text, TTS_MAX_CHARS_PER_SEGMENT);
    state.segmentIndex = 0;
    void playAiSegmentRef.current(0);
  };

  const resolveSystemVoice = (voiceName: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined => {
    const pool = voices.length > 0 ? voices : webVoicesRef.current;
    if (!pool.length) return undefined;
    const name = (voiceName || '').trim();
    if (name) {
      const exact = pool.find((v) => v.name === name);
      if (exact) return exact;
    }
    const fallbackName = pickDefaultChineseVoice(pool);
    return pool.find((v) => v.name === fallbackName) || pool[0];
  };

  const speakSystemSpeechAt = (fullText: string, playOffset: number) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const text = fullText.slice(playOffset);
    if (!text.trim()) return;

    clearAllSystemSpeechSchedules();
    systemSpeechEpochRef.current += 1;
    const epoch = systemSpeechEpochRef.current;
    systemUtteranceRef.current = null;

    if (boundaryTickRef.current) {
      window.clearInterval(boundaryTickRef.current);
      boundaryTickRef.current = null;
    }

    suppressOnEndRef.current = true;
    window.speechSynthesis.cancel();

    const startSpeak = async () => {
      if (epoch !== systemSpeechEpochRef.current) return;
      await waitForSystemSpeechIdle(epoch);
      if (epoch !== systemSpeechEpochRef.current) return;

      window.speechSynthesis.cancel();
      await new Promise<void>((resolve) => {
        systemSpeechTimerRef.current = window.setTimeout(() => {
          systemSpeechTimerRef.current = null;
          resolve();
        }, 40);
      });
      if (epoch !== systemSpeechEpochRef.current) return;

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) webVoicesRef.current = voices;

      const utterance = new SpeechSynthesisUtterance(text);
      const selectedVoice = resolveSystemVoice(webVoiceRef.current, voices);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang || 'zh-TW';
      }
      utterance.rate = webRateRef.current;
      systemUtteranceRef.current = utterance;

      utterance.onstart = () => {
        if (epoch !== systemSpeechEpochRef.current || systemUtteranceRef.current !== utterance) return;
        suppressOnEndRef.current = false;
        setWebIsSpeaking(true);
        setWebIsPaused(false);
        setReadingCharIndex(playOffset);
        ttsStartAtRef.current = Date.now();
        hasBoundaryEventRef.current = false;
        if (boundaryTickRef.current) window.clearInterval(boundaryTickRef.current);
        boundaryTickRef.current = window.setInterval(() => {
          if (epoch !== systemSpeechEpochRef.current || systemUtteranceRef.current !== utterance) return;
          if (!window.speechSynthesis.speaking || window.speechSynthesis.paused) return;
          if (hasBoundaryEventRef.current) return;
          const elapsedSec = (Date.now() - ttsStartAtRef.current) / 1000;
          const charsPerSec = Math.max(4, 8 * webRateRef.current);
          const estimatedIndex = Math.floor(elapsedSec * charsPerSec);
          setReadingCharIndex((prev) => {
            const next = Math.min(fullText.length, playOffset + estimatedIndex);
            if (prev === null) return next;
            return Math.max(prev, next);
          });
        }, 180);
      };

      utterance.onboundary = (event: SpeechSynthesisEvent) => {
        if (epoch !== systemSpeechEpochRef.current || systemUtteranceRef.current !== utterance) return;
        if (typeof event.charIndex !== 'number') return;
        hasBoundaryEventRef.current = true;
        const next = Math.min(fullText.length, playOffset + event.charIndex);
        setReadingCharIndex((prev) => (prev === null ? next : Math.max(prev, next)));
      };

      utterance.onend = () => {
        if (epoch !== systemSpeechEpochRef.current || systemUtteranceRef.current !== utterance) return;
        systemUtteranceRef.current = null;
        if (boundaryTickRef.current) {
          window.clearInterval(boundaryTickRef.current);
          boundaryTickRef.current = null;
        }
        setWebIsSpeaking(false);
        setWebIsPaused(false);
        if (suppressOnEndRef.current) {
          suppressOnEndRef.current = false;
          return;
        }
        void (async () => {
          const moved = await tryAutoAdvanceToNextChapter();
          if (!moved) setReadingCharIndex(null);
        })();
      };

      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        if (epoch !== systemSpeechEpochRef.current || systemUtteranceRef.current !== utterance) return;
        systemUtteranceRef.current = null;
        if (suppressOnEndRef.current) {
          suppressOnEndRef.current = false;
          return;
        }
        const errType = String((event as SpeechSynthesisErrorEvent).error || '').toLowerCase();
        if (errType === 'interrupted' || errType === 'cancelled' || errType === 'canceled') {
          return;
        }
        handleWebStop();
        if (errType === 'not-allowed' || errType === 'notallowed') {
          pendingBrowserSpeechRef.current = { fullText, offset: playOffset, text };
          showToast('手機需再按一次播放，啟用系統語音');
        }
      };

      if (epoch !== systemSpeechEpochRef.current) return;
      window.speechSynthesis.speak(utterance);
    };

    clearSystemSpeechTimer();
    systemSpeechTimerRef.current = window.setTimeout(() => {
      systemSpeechTimerRef.current = null;
      void startSpeak();
    }, 60);
  };

  const restartSystemSpeechAtCurrentPosition = () => {
    if (webAiPlayingRef.current) return;
    const fullText = webTextRef.current;
    if (!fullText.trim()) return;
    const charPos = readingCharIndexRef.current ?? 0;
    const playOffset = Math.max(0, Math.min(charPos, fullText.length));
    speakSystemSpeechAt(fullText, playOffset);
  };

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

  // HTMLAudio 模式（手機主要路徑）的進度更新：以 audio.currentTime / audio.duration 推進 readingCharIndex，
  // 讓反白可隨聲音逐字前進，避免長段時反白卡在段首。
  const startHtmlAudioProgressLoop = (
    audio: HTMLAudioElement,
    charStart: number,
    charEnd: number,
    epoch: number,
  ) => {
    if (aiProgressRafRef.current !== null) cancelAnimationFrame(aiProgressRafRef.current);
    const span = Math.max(0, charEnd - charStart);
    // 預估每秒字數，僅作為 audio.duration 尚未就緒時的後備估算。
    const estimatedCharsPerSec = Math.max(4, 7.5 * Math.max(0.1, webRateRef.current));
    const startedAt = Date.now();
    const tick = () => {
      if (!webAiPlayingRef.current || epoch !== aiPlaybackEpochRef.current) return;
      if (htmlAudioRef.current !== audio) return;
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      let progress = 0;
      if (dur > 0) {
        progress = Math.min(1, Math.max(0, cur / dur));
      } else if (span > 0) {
        // audio.duration 尚未就緒時，以時間 × 推估速度近似推進，避免反白完全靜止。
        const elapsedSec = (Date.now() - startedAt) / 1000;
        progress = Math.min(0.95, Math.max(0, (elapsedSec * estimatedCharsPerSec) / span));
      }
      const idx = span <= 1
        ? charStart
        : charStart + Math.min(span - 1, Math.floor(progress * span));
      setReadingCharIndex((prev) => (prev === null ? idx : Math.max(prev, idx)));
      aiProgressRafRef.current = requestAnimationFrame(tick);
    };
    aiProgressRafRef.current = requestAnimationFrame(tick);
  };

  const syncReadingPosition = (charIndex: number | null) => {
    const textarea = webTextareaRef.current;
    const main = mainScrollRef.current;
    if (!textarea || !main || charIndex === null) {
      setReadingLineViewportY(null);
      return;
    }
    const clamped = Math.max(0, Math.min(charIndex, textarea.value.length));
    const computed = window.getComputedStyle(textarea);
    const parsedLineHeight = parseFloat(computed.lineHeight || '');
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 2.2;
    const targetTopInTextarea = Math.max(0, getScrollContentOffsetTopForCharIndex(textarea, clamped));
    setReadingLineHeight(lineHeight);
    // 反白條本身依然以「textarea 內絕對位置」定位，並隨外層 main 一起捲動；
    // 我們透過下方主動捲動 main，讓反白條在「視口中的位置」始終貼齊錨點，視覺上即不動。
    setReadingLineViewportY(targetTopInTextarea);

    const viewportHeight = main.clientHeight || 600;
    const mainScrollTop = main.scrollTop;
    const mainRect = main.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    const textareaTopInMainContent = textareaRect.top - mainRect.top + mainScrollTop;
    const absoluteTopInMain = textareaTopInMainContent + targetTopInTextarea;

    const anchorRatio = 0.34; // 朗讀行貼齊視口上方約 1/3 處
    const pinnedY = viewportHeight * anchorRatio;
    const maxScrollTop = Math.max(0, main.scrollHeight - viewportHeight);
    const desiredTop = Math.max(0, Math.min(absoluteTopInMain - pinnedY, maxScrollTop));

    // 每次都精確對齊：main.scrollTop = absoluteTopInMain - pinnedY，
    // 使反白條在視口中保持固定 Y 座標。只在差距 < 0.5px 時略過，避免無意義的微小重排。
    // 接近章節首/尾時 desiredTop 會被 clamp，此時反白會自然落到字元的實際位置（物理限制）。
    if (Math.abs(desiredTop - mainScrollTop) < 0.5) return;
    lastAutoScrollAtRef.current = Date.now();
    main.scrollTo({ top: desiredTop, behavior: 'auto' });
  };

  useEffect(() => {
    if (readingCharIndex === null) {
      setReadingLineViewportY(null);
      return;
    }
    syncReadingPosition(readingCharIndex);
  }, [readingCharIndex, fontSize]);

  useEffect(() => {
    const main = mainScrollRef.current;
    if (!main) return;
    const handleScroll = () => {
      if (readingCharIndex !== null) syncReadingPosition(readingCharIndex);
    };
    main.addEventListener('scroll', handleScroll);
    return () => main.removeEventListener('scroll', handleScroll);
  }, [readingCharIndex, fontSize]);

  // 讓 textarea 隨內容自動撐高，配合外層 main 統一捲動，避免雙重滾輪。
  useEffect(() => {
    const textarea = webTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [webText, fontSize]);

  useEffect(() => {
    novelRef.current = novel;
  }, [novel]);

  useEffect(() => {
    const syncTtsQuotaDisplay = () => {
      setTtsRemainingChars(getRemainingTtsChars());
    };
    syncTtsQuotaDisplay();
    window.addEventListener(TTS_QUOTA_UPDATE_EVENT, syncTtsQuotaDisplay);
    window.addEventListener('storage', syncTtsQuotaDisplay);
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncTtsQuotaDisplay();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(TTS_QUOTA_UPDATE_EVENT, syncTtsQuotaDisplay);
      window.removeEventListener('storage', syncTtsQuotaDisplay);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      const s = JSON.parse(savedSettings);
      setVoice(s.voice || 'Aoede');
      setVolume(s.volume ?? 0.8);
      setPlaybackRate(s.playbackRate ?? 1);
      setFontSize(s.fontSize ?? 22);
      setTheme(s.theme || 'dark');
    }
    const savedWebRate = localStorage.getItem(STORAGE_KEY_WEB_RATE);
    const rateMigrated = localStorage.getItem(STORAGE_KEY_DEFAULT_RATE_MIGRATION) === 'true';
    if (savedWebRate) {
      const parsedRate = normalizePlaybackRate(parseFloat(savedWebRate));
      // 一次性遷移：舊版本預設值 0.75 升級為 1；使用者若主動選了其它速度則保留。
      if (!rateMigrated && parsedRate === 0.75) {
        setWebRate(1);
      } else {
        setWebRate(parsedRate);
      }
    }
    if (!rateMigrated) {
      localStorage.setItem(STORAGE_KEY_DEFAULT_RATE_MIGRATION, 'true');
    }
    const savedUseAi = localStorage.getItem(STORAGE_KEY_USE_AI_READING);
    if (savedUseAi === 'true') setUseAiReading(true);
    else if (savedUseAi === 'false') setUseAiReading(false);
    else setUseAiReading(false);
    const savedAutoNext = localStorage.getItem(STORAGE_KEY_AUTO_NEXT);
    if (savedAutoNext === 'true') setAutoNextChapter(true);
    else if (savedAutoNext === 'false') setAutoNextChapter(false);
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
          lineNumber: Number.isFinite(Number(x.lineNumber)) && Number(x.lineNumber) > 0 ? Number(x.lineNumber) : 1,
          savedAt: Number(x.savedAt || Date.now()),
        })) as BookmarkData[];
        setBookmarks(normalized);
        if (normalized.length > 0) setShowResumeToast(true);
      } catch {
        // ignore invalid bookmark payload
      }
    }

    const savedWebVoice = localStorage.getItem(STORAGE_KEY_WEB_VOICE);
    if (savedWebVoice) setWebVoice(savedWebVoice);

    const loadVoices = () => setWebVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  useEffect(() => {
    if (webVoice) localStorage.setItem(STORAGE_KEY_WEB_VOICE, webVoice);
  }, [webVoice]);

  useEffect(() => {
    if (webVoices.length === 0) return;
    const chinese = webVoices.filter(isChineseSystemVoice);
    const pool = chinese.length > 0 ? chinese : webVoices;
    if (webVoice && pool.some((v) => v.name === webVoice)) return;
    const saved = localStorage.getItem(STORAGE_KEY_WEB_VOICE);
    if (saved && pool.some((v) => v.name === saved)) {
      setWebVoice(saved);
      return;
    }
    const pick = pickDefaultChineseVoice(pool);
    if (pick) setWebVoice(pick);
  }, [webVoices, webVoice]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_USE_AI_READING, useAiReading ? 'true' : 'false');
  }, [useAiReading]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY_SETTINGS,
      JSON.stringify({ voice, volume, playbackRate, fontSize, theme })
    );
  }, [voice, volume, playbackRate, fontSize, theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_AUTO_NEXT, autoNextChapter ? 'true' : 'false');
  }, [autoNextChapter]);

  useEffect(() => {
    const normalized = normalizePlaybackRate(webRate);
    if (normalized !== webRate) {
      setWebRate(normalized);
      return;
    }
    localStorage.setItem(STORAGE_KEY_WEB_RATE, String(normalized));
  }, [webRate]);

  useEffect(() => {
    const pending = pendingRestoreRef.current;
    const textarea = webTextareaRef.current;
    const main = mainScrollRef.current;
    if (!pending || !textarea || !main || !webText.trim()) return;
    main.scrollTo({ top: Math.max(0, pending.scrollTop), behavior: 'auto' });
    const restoredCharIndex = typeof pending.readingCharIndex === 'number'
      ? pending.readingCharIndex
      : getCharIndexFromLineNumber(webText, pending.lineNumber || 1);
    setReadingCharIndex(restoredCharIndex);
    // 書籤定位完成後，清除「強制章首播放」旗標，確保可從書籤行開始播放。
    forceStartFromTopRef.current = false;
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

  // 必須「同步」在 user gesture（如 onClick）中呼叫，
  // 才能讓手機瀏覽器把 AudioContext 與 <audio> 元素都標記為「已啟用」。
  // 啟用後即使 fetch 完音訊已脫離 user gesture，也仍可程式化播放後續 segment。
  const unlockMediaOnGesture = () => {
    if (mediaUnlockedRef.current) {
      // 已啟用：仍保險地再 resume 一次（避免被系統暫停過）。
      try {
        const ctx = audioContextRef.current;
        if (ctx && ctx.state === 'suspended') void ctx.resume();
      } catch {
        /* ignore */
      }
      return;
    }
    mediaUnlockedRef.current = true;

    // 1) 啟用 AudioContext：resume + 播放 1 sample 的無聲 buffer。
    try {
      const ctx = initAudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      const silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const silentSource = ctx.createBufferSource();
      silentSource.buffer = silentBuffer;
      silentSource.connect(ctx.destination);
      silentSource.start(0);
    } catch {
      /* ignore */
    }

    // 2) 啟用單一可重用的 <audio> 元素：play() 一段極短無聲 mp3。
    // 此元素一旦在 user gesture 中 play() 成功過，
    // 後續即使在非 user gesture 內也可程式化呼叫 play()/load()/src=。
    try {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      // 極短無聲 mp3 data URL（約幾百 bytes，僅用於 unlock，不會實際發聲）
      audio.src = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID/////////////////////////////////////////////8AAAA5MQU1FMy4xMDAB7QAAAAAAAAAAFCAJAlsTAAACAAACcU+IxA8AAAAAAAAAAAAAAAAAAP/7kMQAAA5MTEoAACE4DJyzMABE7gAAH/8AAAAA';
      audio.muted = false;
      audio.volume = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 1;
        }).catch(() => {
          // 即便靜音音訊播放失敗也保留元素；後續 play() 仍會嘗試。
          audio.volume = 1;
        });
      } else {
        audio.volume = 1;
      }
      unlockedHtmlAudioRef.current = audio;
    } catch {
      /* ignore */
    }
  };

  // 將 base64 mp3 轉為 Blob URL（取代 data:audio/mpeg;base64,...，避免手機 Safari 對大 data URL 的限制）。
  const buildBlobUrlFromBase64Mp3 = (base64Audio: string): string => {
    const bytes = decode(base64Audio);
    // 使用 slice().buffer 取得獨立 ArrayBuffer，避免 TypeScript 對 SharedArrayBuffer 推論的型別錯誤。
    const blob = new Blob([bytes.slice().buffer], { type: 'audio/mpeg' });
    return URL.createObjectURL(blob);
  };

  const releaseCurrentBlobUrl = () => {
    if (currentBlobUrlRef.current) {
      try { URL.revokeObjectURL(currentBlobUrlRef.current); } catch { /* ignore */ }
      currentBlobUrlRef.current = null;
    }
  };

  const handleSearch = async (input: string) => {
    try {
      handleWebStop(true);
      setWebLoading(true);
      setWebError(null);
      const data = await fetchNovelContent(input);
      const resolvedTitle = data.title?.trim() || deriveFallbackTitle(input, data.content || '');
      const resolvedSourceUrl = normalizeChapterUrl(data.sourceUrl, input) || data.sourceUrl;
      const resolvedNovel: NovelContent = {
        ...data,
        title: resolvedTitle,
        sourceUrl: resolvedSourceUrl,
        nextChapterUrl: normalizeChapterUrl(data.nextChapterUrl, resolvedSourceUrl || input),
        prevChapterUrl: normalizeChapterUrl(data.prevChapterUrl, resolvedSourceUrl || input),
        chapters: Array.isArray(data.chapters)
          ? data.chapters.map((ch) => ({
              ...ch,
              url: normalizeChapterUrl(ch.url, resolvedSourceUrl || input) || ch.url
            }))
          : data.chapters
      };
      setNovel(resolvedNovel);
      setIsChaptersOpen(false);
      setWebTitle(resolvedTitle);
      setWebText(data.content);
      setShowSearch(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setWebError(getFriendlyError(err?.message || '載入失敗。'));
    } finally {
      setWebLoading(false);
    }
  };

  const tryAutoAdvanceToNextChapter = async (): Promise<boolean> => {
    if (!autoNextChapter) return false;
    const nextUrl = normalizeChapterUrl(
      novelRef.current?.nextChapterUrl,
      novelRef.current?.sourceUrl
    );
    if (!nextUrl) return false;
    // 若已有跳章流程進行中，不應回報成功，避免呼叫端誤判為已完成切章。
    if (autoAdvanceInFlightRef.current) return false;
    autoAdvanceInFlightRef.current = true;
    shouldAutoplayAfterSearchRef.current = true;
    try {
      await handleSearch(nextUrl);
      return true;
    } catch {
      shouldAutoplayAfterSearchRef.current = false;
      return false;
    } finally {
      autoAdvanceInFlightRef.current = false;
    }
  };

  const primeSystemSpeech = () => {
    if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') return;
    try {
      const warmup = new SpeechSynthesisUtterance('\u200b');
      warmup.volume = 0;
      warmup.rate = 1;
      window.speechSynthesis.speak(warmup);
      window.speechSynthesis.cancel();
    } catch {
      // ignore warmup failures; fallback path still handles retry prompt
    }
  };

  const getPlaybackStartIndex = (text: string, preferredIndex: number | null): number => {
    const firstContentIndex = text.search(/\S/);
    const fallback = firstContentIndex >= 0 ? firstContentIndex : 0;
    if (typeof preferredIndex === 'number' && Number.isFinite(preferredIndex)) {
      const clamped = Math.max(0, Math.min(preferredIndex, text.length));
      if (clamped >= Math.max(0, text.length - 1)) return fallback;
      return clamped;
    }
    return fallback;
  };

  const handleSubmitSearch = async () => {
    let value = webUrl.trim();
    if (!value) return;
    const looksLikeUrl = /^https?:\/\//i.test(value);
    if (searchMode === 'url') {
      if (!looksLikeUrl) {
        setWebError('網址模式請輸入完整網址（需含 http:// 或 https://）');
        return;
      }
      try {
        new URL(value);
      } catch {
        setWebError('網址格式不正確，請檢查後再試');
        return;
      }
    } else if (looksLikeUrl) {
      // 新搜尋模式：若輸入了像 https://聚寶仙盆 這類非完整網址，直接降級為關鍵字搜尋。
      try {
        const u = new URL(value);
        if (!u.hostname || !u.hostname.includes('.')) {
          value = value.replace(/^https?:\/\//i, '').trim();
          if (!value) {
            setWebError('網址格式不正確。若要搜尋書名，請直接輸入書名關鍵字。');
            return;
          }
        }
      } catch {
        value = value.replace(/^https?:\/\//i, '').trim();
        if (!value) {
          setWebError('網址格式不正確。若要搜尋書名，請直接輸入書名關鍵字。');
          return;
        }
      }
    }
    setIsUrlModalOpen(false);
    await handleSearch(value);
  };

  const startBrowserSpeech = (fullText: string, offset: number, _text: string) => {
    pendingBrowserSpeechRef.current = null;
    handleWebStop();
    speakSystemSpeechAt(fullText, offset);
  };

  const beginAiPlaybackAtOffset = async (fullText: string, offset: number) => {
    const text = fullText.slice(offset);
    if (!text.trim()) return;
    aiPlaybackEpochRef.current += 1;
    const aiEpoch = aiPlaybackEpochRef.current;
    const isActiveAi = () => webAiPlayingRef.current && aiEpoch === aiPlaybackEpochRef.current;
    suppressOnEndRef.current = false;
    const segments = splitTextForTTSWithRanges(text, TTS_MAX_CHARS_PER_SEGMENT);
    setWebAiLoading(true);
    const ctx = initAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    if (!useAiReadingRef.current || aiEpoch !== aiPlaybackEpochRef.current) {
      setWebAiLoading(false);
      return;
    }
    webAiPlayingRef.current = true;
    aiPlaybackStateRef.current = { fullText, offset, segments, segmentIndex: 0, ctx };
    const playNextSegment = async (index: number) => {
      if (!isActiveAi()) return;
      const playback = aiPlaybackStateRef.current;
      if (!playback) return;
      playback.segmentIndex = index;
      const activeSegments = playback.segments;
      const baseOffset = playback.offset;
      if (index >= activeSegments.length) {
        const moved = await tryAutoAdvanceToNextChapter();
        if (!moved) handleWebStop();
        return;
      }
      stopCurrentAiSegmentOnly();
      try {
        const currentSegment = activeSegments[index];
        setReadingCharIndex(baseOffset + currentSegment.start);
        const base64Audio = await generateSpeech(currentSegment.text, voiceRef.current);
        if (!isActiveAi()) return;
        if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) {
          window.speechSynthesis.cancel();
        }
        setTtsRemainingChars(getRemainingTtsChars());
        const rate = webRateRef.current;
        let usedWebAudioFallback = false;
        try {
          aiPlaybackModeRef.current = 'htmlaudio';
          // 重用已被 user gesture 啟用過的單一 audio 元素，避免每段 new Audio() 在手機被自動播放政策阻擋。
          const audio = unlockedHtmlAudioRef.current || new Audio();
          if (!unlockedHtmlAudioRef.current) {
            unlockedHtmlAudioRef.current = audio;
          }
          // 釋放上一段的 blob URL，再建立本段的 blob URL（取代大型 data URL）。
          releaseCurrentBlobUrl();
          const blobUrl = buildBlobUrlFromBase64Mp3(base64Audio);
          currentBlobUrlRef.current = blobUrl;
          // 先停止舊內容並切換 src。
          try { audio.pause(); } catch { /* ignore */ }
          audio.onended = null;
          audio.onerror = null;
          audio.src = blobUrl;
          try { audio.load(); } catch { /* ignore */ }
          audio.playbackRate = rate;
          audio.volume = 1;
          const playToken = aiEpoch;
          htmlAudioRef.current = audio;
          if (!isActiveAi()) return;

          const segCharStart = baseOffset + currentSegment.start;
          const segCharEnd = baseOffset + currentSegment.end;

          await new Promise<void>((resolve, reject) => {
            audio.onended = () => {
              stopAiProgressLoop();
              // 段結束時，把反白推到段尾，避免最後幾個字未被高亮過。
              setReadingCharIndex((prev) => {
                const target = Math.max(segCharStart, segCharEnd - 1);
                return prev === null ? target : Math.max(prev, target);
              });
              htmlAudioRef.current = null;
              resolve();
            };
            audio.onerror = () => {
              stopAiProgressLoop();
              htmlAudioRef.current = null;
              if (!isActiveAi() || playToken !== aiPlaybackEpochRef.current) {
                resolve();
                return;
              }
              reject(new Error('HTMLAudio 播放失敗'));
            };
            void audio.play().then(() => {
              if (!isActiveAi() || playToken !== aiPlaybackEpochRef.current) return;
              if (htmlAudioRef.current !== audio) return;
              startHtmlAudioProgressLoop(audio, segCharStart, segCharEnd, playToken);
            }).catch((err) => {
              stopAiProgressLoop();
              htmlAudioRef.current = null;
              if (!isActiveAi() || playToken !== aiPlaybackEpochRef.current) {
                resolve();
                return;
              }
              reject(err);
            });
          });

          if (isActiveAi() && playToken === aiPlaybackEpochRef.current) {
            void playAiSegmentRef.current(index + 1);
          }
          setWebIsSpeaking(true);
          setWebIsPaused(false);
          setWebAiLoading(false);
          return;
        } catch {
          if (!isActiveAi()) return;
          usedWebAudioFallback = true;
          if (!isActiveAi()) return;
          const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
          if (!isActiveAi()) return;
          aiPlaybackModeRef.current = 'webaudio';
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = rate;
          const gainNode = ctx.createGain();
          source.connect(gainNode);
          gainNode.connect(ctx.destination);

          const now = ctx.currentTime;
          // 實際播放時長 = 原始長度 / 播放速率（rate<1 會變長，rate>1 會變短）
          // 淡入淡出必須對齊「實際播放時間軸」，否則慢速時 gain 會提早歸零，導致後段變靜音。
          const actualPlayDuration = audioBuffer.duration / Math.max(0.1, rate);
          const fadeInSec = Math.min(0.02, Math.max(0.006, actualPlayDuration * 0.04));
          const fadeOutSec = Math.min(0.03, Math.max(0.01, actualPlayDuration * 0.04));
          const playGain = 0.9;
          gainNode.gain.cancelScheduledValues(now);
          gainNode.gain.setValueAtTime(0, now);
          gainNode.gain.linearRampToValueAtTime(playGain, now + fadeInSec);
          const fadeOutStart = Math.max(now + fadeInSec, now + actualPlayDuration - fadeOutSec);
          gainNode.gain.setValueAtTime(playGain, fadeOutStart);
          gainNode.gain.linearRampToValueAtTime(0, now + actualPlayDuration);
          source.onended = () => {
            stopAiProgressLoop();
            if (isActiveAi()) void playAiSegmentRef.current(index + 1);
          };
          source.start(0);
          sourceRef.current = source;
          aiSegmentProgressRef.current = {
            ctx,
            startCtxTime: ctx.currentTime,
            bufferDuration: audioBuffer.duration,
            duration: audioBuffer.duration / Math.max(0.1, rate),
            charStart: baseOffset + currentSegment.start,
            charEnd: baseOffset + currentSegment.end,
          };
          startAiProgressLoop();
        }
        if (!usedWebAudioFallback) return;
        setWebIsSpeaking(true);
        setWebIsPaused(false);
        setWebAiLoading(false);
      } catch (e: unknown) {
        if (!isActiveAi()) return;
        setWebError((prev) => (prev?.startsWith('AI 朗讀') ? null : prev));
        webAiPlayingRef.current = false;
        aiPlaybackStateRef.current = null;
        stopAiProgressLoop();
        sourceRef.current = null;
        setWebAiLoading(false);
        const quotaMsg = e instanceof TtsQuotaExceededError
          ? e.message
          : 'AI 朗讀不可用，已自動切換為系統語音（免費）';
        showToast(quotaMsg);
        console.warn('AI 朗讀失敗，已自動切換系統朗讀', e);
        startBrowserSpeech(fullText, offset, text);
      }
    };
    playAiSegmentRef.current = playNextSegment;
    void playNextSegment(0);
  };

  const switchToAiSpeechAtCurrentPosition = async () => {
    stopSystemSpeechOnly();
    const stopEpoch = systemSpeechEpochRef.current;
    setWebIsSpeaking(false);
    setWebIsPaused(false);

    await waitForSystemSpeechIdle(stopEpoch);
    if (!useAiReadingRef.current) return;

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 50);
    });
    if (!useAiReadingRef.current) return;

    const fullText = webTextRef.current;
    if (!fullText.trim()) return;
    const charPos = readingCharIndexRef.current ?? 0;
    const playOffset = Math.max(0, Math.min(charPos, fullText.length));
    await beginAiPlaybackAtOffset(fullText, playOffset);
  };

  const handleWebPlayPause = async () => {
    // 必須在所有 await 之前「同步」啟用 AudioContext 與 <audio> 元素，
    // 否則手機瀏覽器會視為非 user gesture 觸發後續播放而靜音。
    unlockMediaOnGesture();
    if (pendingBrowserSpeechRef.current && !webAiPlayingRef.current && !window.speechSynthesis.speaking) {
      primeSystemSpeech();
      const pending = pendingBrowserSpeechRef.current;
      pendingBrowserSpeechRef.current = null;
      startBrowserSpeech(pending.fullText, pending.offset, pending.text);
      return;
    }
    const fullText = webText;
    if (!fullText.trim()) return;
    const offset = forceStartFromTopRef.current
      ? getPlaybackStartIndex(fullText, null)
      : getPlaybackStartIndex(fullText, readingCharIndex);
    forceStartFromTopRef.current = false;
    const text = fullText.slice(offset);
    if (webAiPlayingRef.current) {
      if (aiPlaybackModeRef.current === 'htmlaudio' && htmlAudioRef.current) {
        if (!webIsPaused) { htmlAudioRef.current.pause(); setWebIsPaused(true); }
        else { await htmlAudioRef.current.play(); setWebIsPaused(false); }
        return;
      }
      if (audioContextRef.current) {
        if (!webIsPaused) { await audioContextRef.current.suspend(); setWebIsPaused(true); }
        else { await audioContextRef.current.resume(); setWebIsPaused(false); }
      }
      return;
    }
    if (window.speechSynthesis.speaking && !webAiPlayingRef.current) {
      if (window.speechSynthesis.paused) { window.speechSynthesis.resume(); setWebIsPaused(false); }
      else { window.speechSynthesis.pause(); setWebIsPaused(true); }
      return;
    }
    // 僅在「新開始播放」前做一次系統語音預熱，避免干擾暫停/續播切換。
    primeSystemSpeech();
    if (useAiReading) {
      handleWebStop();
      await beginAiPlaybackAtOffset(fullText, offset);
    } else {
      startBrowserSpeech(fullText, offset, text);
    }
  };

  const handleWebStop = (resetReadingPosition: boolean = false) => {
    systemSpeechEpochRef.current += 1;
    aiPlaybackEpochRef.current += 1;
    systemUtteranceRef.current = null;
    clearAllSystemSpeechSchedules();
    const hasActiveSystemSpeech = typeof window !== 'undefined'
      && typeof window.speechSynthesis !== 'undefined'
      && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
    const hasActivePlayback = webAiPlayingRef.current || !!sourceRef.current || !!htmlAudioRef.current || hasActiveSystemSpeech;
    suppressOnEndRef.current = hasActivePlayback;
    pendingBrowserSpeechRef.current = null;
    stopAiProgressLoop();
    if (webAiPlayingRef.current) {
      webAiPlayingRef.current = false;
      aiPlaybackStateRef.current = null;
      try { sourceRef.current?.stop(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (htmlAudioRef.current) {
      const audio = htmlAudioRef.current;
      audio.onended = null;
      audio.onerror = null;
      try { audio.pause(); } catch {}
      try { audio.removeAttribute('src'); } catch {}
      try { audio.load(); } catch {}
      htmlAudioRef.current = null;
    }
    releaseCurrentBlobUrl();
    aiPlaybackModeRef.current = 'webaudio';
    if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
    if (boundaryTickRef.current) { window.clearInterval(boundaryTickRef.current); boundaryTickRef.current = null; }
    setWebIsSpeaking(false); setWebIsPaused(false); setWebAiLoading(false);
    if (resetReadingPosition) {
      forceStartFromTopRef.current = true;
      setReadingCharIndex(null);
      const main = mainScrollRef.current;
      if (main) main.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  useEffect(() => {
    if (!shouldAutoplayAfterSearchRef.current) return;
    shouldAutoplayAfterSearchRef.current = false;
    if (!webText.trim()) return;
    void handleWebPlayPause();
  }, [webText]);

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

  const playbackSettingsMountedRef = useRef(false);
  const readingModeMountedRef = useRef(false);
  const prevUseAiReadingRef = useRef(useAiReading);
  const webAiLoadingRef = useRef(webAiLoading);
  useEffect(() => { webAiLoadingRef.current = webAiLoading; }, [webAiLoading]);
  const prevVoiceRef = useRef(voice);
  const prevWebRateRef = useRef(webRate);
  const prevWebVoiceRef = useRef(webVoice);
  useEffect(() => {
    if (!playbackSettingsMountedRef.current) {
      playbackSettingsMountedRef.current = true;
      prevVoiceRef.current = voice;
      prevWebRateRef.current = webRate;
      prevWebVoiceRef.current = webVoice;
      return;
    }
    const voiceChanged = prevVoiceRef.current !== voice;
    const rateChanged = prevWebRateRef.current !== webRate;
    const webVoiceChanged = prevWebVoiceRef.current !== webVoice;
    prevVoiceRef.current = voice;
    prevWebRateRef.current = webRate;
    prevWebVoiceRef.current = webVoice;
    if (!voiceChanged && !rateChanged && !webVoiceChanged) return;

    const systemSpeechActive = typeof window !== 'undefined'
      && typeof window.speechSynthesis !== 'undefined'
      && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
    const isPlaying = webAiPlayingRef.current || systemSpeechActive || webIsSpeakingRef.current;
    if (!isPlaying) return;

    if (webAiPlayingRef.current) {
      if (rateChanged && !voiceChanged) {
        applyLivePlaybackRate();
        return;
      }
      if (voiceChanged) {
        restartAiPlaybackAtCurrentPosition();
        showToast('已切換 AI 語音，從目前位置重新朗讀');
      }
      return;
    }

    if (!webAiPlayingRef.current && (systemSpeechActive || webIsSpeakingRef.current) && (webVoiceChanged || rateChanged)) {
      if (playbackRestartTimerRef.current != null) {
        window.clearTimeout(playbackRestartTimerRef.current);
      }
      const toastMsg = webVoiceChanged
        ? '已切換系統語音，從目前位置重新朗讀'
        : '已調整語速，從目前位置重新朗讀';
      playbackRestartTimerRef.current = window.setTimeout(() => {
        playbackRestartTimerRef.current = null;
        if (webAiPlayingRef.current) return;
        restartSystemSpeechAtCurrentPosition();
        showToast(toastMsg);
      }, 160);
    }

    return () => {
      if (playbackRestartTimerRef.current != null) {
        window.clearTimeout(playbackRestartTimerRef.current);
        playbackRestartTimerRef.current = null;
      }
    };
  }, [voice, webRate, webVoice]);

  useEffect(() => {
    if (!readingModeMountedRef.current) {
      readingModeMountedRef.current = true;
      prevUseAiReadingRef.current = useAiReading;
      return;
    }
    const prevAi = prevUseAiReadingRef.current;
    prevUseAiReadingRef.current = useAiReading;
    if (prevAi === useAiReading) return;

    const systemSpeechActive = typeof window !== 'undefined'
      && typeof window.speechSynthesis !== 'undefined'
      && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
    const isPlaying = webAiPlayingRef.current
      || webAiLoadingRef.current
      || systemSpeechActive
      || webIsSpeakingRef.current;
    if (!isPlaying) return;

    if (prevAi && !useAiReading) {
      switchToSystemSpeechAtCurrentPosition();
      showToast('已切換為系統語音，從目前位置重新朗讀');
      return;
    }
    if (!prevAi && useAiReading) {
      void switchToAiSpeechAtCurrentPosition();
      showToast('已切換為 AI 語音，從目前位置重新朗讀');
    }
  }, [useAiReading]);

  const estimateCurrentLineNumber = (textarea: HTMLTextAreaElement, charIndex: number | null): number => {
    if (charIndex !== null) {
      const i = Math.max(0, Math.min(charIndex, textarea.value.length));
      return Math.max(1, textarea.value.slice(0, i).split(/\r?\n/).length);
    }
    const computed = window.getComputedStyle(textarea);
    const parsedLineHeight = parseFloat(computed.lineHeight || '');
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 2.2;
    const main = mainScrollRef.current;
    const mainScrollTop = main?.scrollTop ?? 0;
    const mainRect = main?.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    const textareaTopInMain = mainRect ? (textareaRect.top - mainRect.top + mainScrollTop) : 0;
    const offsetInTextarea = Math.max(0, mainScrollTop - textareaTopInMain);
    return Math.max(1, Math.floor(offsetInTextarea / Math.max(1, lineHeight)) + 1);
  };

  const getCharIndexFromLineNumber = (text: string, lineNumber: number): number => {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return 0;
    const targetLine = Math.max(1, Math.min(lineNumber, lines.length));
    let index = 0;
    for (let i = 1; i < targetLine; i += 1) {
      index += lines[i - 1].length + 1;
    }
    return Math.max(0, Math.min(index, text.length));
  };

  const handleSaveBookmark = () => {
    const textarea = webTextareaRef.current;
    const main = mainScrollRef.current;
    if (!webText.trim() || !textarea) {
      showToast('目前沒有可儲存的內容');
      return;
    }
    const lineNumber = estimateCurrentLineNumber(textarea, readingCharIndex);
    const fallbackCharIndex = getCharIndexFromLineNumber(webText, lineNumber);
    const payload: BookmarkData = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: webTitle || novel?.title || '未命名章節',
      sourceUrl: novel?.sourceUrl || webUrl || '',
      scrollTop: main?.scrollTop ?? 0,
      readingCharIndex: typeof readingCharIndex === 'number' ? readingCharIndex : fallbackCharIndex,
      lineNumber,
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
    showToast(`已回到第 ${chosen.lineNumber || 1} 行`);
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
    <div className={`h-screen overflow-hidden flex flex-col transition-colors duration-500 ${getThemeClass()}`}>
      <Header onToggleMenu={() => setIsMenuOpen(true)} title={webTitle || novel?.title} />
      
      <Sidebar 
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenBrowse={() => setIsBrowseOpen(true)}
        onOpenLibrary={() => setIsBrowseOpen(true)}
        onConvertToTraditional={handleConvertToTraditional}
        onOpenUrlModal={() => { setSearchMode('url'); setWebUrl(''); setIsUrlModalOpen(true); setIsMenuOpen(false); }}
        currentNovelTitle={novel?.title ?? webTitle}
        webRate={webRate}
        setWebRate={setWebRate}
        voice={voice}
        setVoice={setVoice}
      autoNextChapter={autoNextChapter}
      setAutoNextChapter={setAutoNextChapter}
        onAutoNextToggle={(enabled) => showToast(enabled ? '已開啟自動下一章' : '已關閉自動下一章')}
        webVoice={webVoice}
        setWebVoice={setWebVoice}
        webVoices={webVoices}
        useAiReading={useAiReading}
        setUseAiReading={setUseAiReading}
      />

      <main ref={mainScrollRef} className="flex-1 w-full overflow-y-auto px-4 md:px-12 lg:px-24">
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
                  fontSize: `${fontSize}px`,
                  paddingBottom: '42vh'
                }}
                className={`relative z-20 w-full min-h-[76vh] bg-transparent border-0 focus:ring-0 leading-[2.2] resize-none overflow-hidden serif-font ${theme === 'sepia' ? 'placeholder:text-[#5b4636]/30' : 'placeholder:opacity-30'}`}
              />
            </div>
          </div>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-4 z-[100] bg-gradient-to-t from-black/80 via-black/40 to-transparent backdrop-blur-sm pointer-events-none">
        <div className="max-w-sm mx-auto mb-2 pointer-events-none text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/45 px-3 py-1 text-xs text-white/90">
            <span>{useAiReading ? `AI朗讀·剩${ttsRemainingChars.toLocaleString()}/${TTS_MONTHLY_CHAR_LIMIT.toLocaleString()}字` : '系統語音（免費）'}</span>
            <span>·</span>
            <span>{webRate}x</span>
            <span>·</span>
            <span>自動下一章{autoNextChapter ? '開' : '關'}</span>
          </div>
        </div>
        <div className="max-w-md mx-auto flex justify-center items-center gap-4 pointer-events-auto">
          <button onClick={() => novel?.prevChapterUrl && handleSearch(novel.prevChapterUrl)} disabled={!novel?.prevChapterUrl} className="p-3 bg-slate-700 text-slate-50 border border-white/20 rounded-full disabled:opacity-30 hover:bg-slate-600 transition-all shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button onClick={handleWebPlayPause} className="p-3 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl hover:scale-105 active:scale-95 transition-all">
            {webAiLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : (webIsSpeaking && !webIsPaused ? <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><path d="m7 4 12 8-12 8V4z"/></svg>)}
          </button>
          <button onClick={() => handleWebStop(true)} className="p-3 bg-rose-600 text-white border border-rose-300/40 rounded-full flex items-center justify-center hover:bg-rose-500 transition-all shadow-lg">
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
              <div>
                <label className="block text-sm font-bold text-slate-400 mb-3 uppercase tracking-widest">AI 語音</label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className={VOICE_SELECT_CLASS}
                >
                  <optgroup label="台灣">
                    {AI_TAIWAN_VOICE_OPTIONS.map((v) => (
                      <option key={v.id} value={v.id}>
                        台灣・{v.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="華語">
                    {AI_HUAYU_VOICE_OPTIONS.map((v) => (
                      <option key={v.id} value={v.id}>
                        華語・{v.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div><label className="block text-sm font-bold text-slate-400 mb-4 uppercase tracking-widest">閱讀主題</label><div className="grid grid-cols-3 gap-3">{['dark', 'sepia', 'slate'].map(t => (<button key={t} onClick={() => {setTheme(t as any); setIsSettingsOpen(false);}} className={`py-4 rounded-2xl border transition-all font-bold ${theme === t ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-white/5 bg-white/5 text-slate-500'}`}>{t === 'dark' ? '深邃黑' : t === 'sepia' ? '羊皮紙' : '岩板灰'}</button>))}</div></div>
            </div>
          </div>
        </div>
      )}

      {isUrlModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/10 w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl text-slate-100 animate-fade-in-up">
            <h2 className="text-2xl font-bold mb-6 text-center">{searchMode === 'url' ? '網址抓取' : '新搜尋'}</h2>
            <div className="space-y-4">
              <input value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder={searchMode === 'url' ? '請輸入完整網址（https://...）' : '輸入書名關鍵字或網址...'} className="w-full bg-slate-800 border border-white/5 p-5 rounded-2xl outline-none" />
              <button onClick={handleSubmitSearch} disabled={webLoading} className="w-full py-5 bg-indigo-600 rounded-2xl font-bold text-lg">{webLoading ? '解析中...' : (searchMode === 'url' ? '開始抓取' : '立即搜尋')}</button>
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
                    <div className="text-xs text-slate-400">第 {b.lineNumber || 1} 行</div>
                    <div className="text-xs text-slate-500">{new Date(b.savedAt).toLocaleString()}</div>
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
