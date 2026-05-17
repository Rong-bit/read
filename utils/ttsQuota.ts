const STORAGE_KEY = 'google_tts_monthly_usage';
const SESSION_STORAGE_KEY = 'google_tts_monthly_usage_session';

/** 自訂事件：用量更新後通知 UI 同步 */
export const TTS_QUOTA_UPDATE_EVENT = 'tts-quota-updated';

/** 每月 AI 朗讀字數上限（保守值，避免共用 API 金鑰超額） */
export const TTS_MONTHLY_CHAR_LIMIT = 200_000;

/** 單次請求建議上限（須與後端 GOOGLE_TTS_MAX_CHARS_PER_REQUEST 對齊） */
export const TTS_MAX_CHARS_PER_SEGMENT = 400;

const currentMonthKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export type TtsUsage = { month: string; chars: number };

const isBrowser = (): boolean => typeof window !== 'undefined';

const parseUsageRaw = (raw: string | null): TtsUsage | null => {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as TtsUsage;
    if (!data || typeof data.month !== 'string') return null;
    const chars = Number(data.chars);
    if (!Number.isFinite(chars) || chars < 0) return null;
    return { month: data.month, chars };
  } catch {
    return null;
  }
};

const readUsageFromStore = (getItem: (key: string) => string | null): TtsUsage | null => {
  try {
    return parseUsageRaw(getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

const readUsageFromSessionStore = (): TtsUsage | null => {
  if (!isBrowser()) return null;
  try {
    return parseUsageRaw(window.sessionStorage.getItem(SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
};

const mergeUsageForMonth = (month: string, ...entries: Array<TtsUsage | null>): TtsUsage => {
  let chars = 0;
  for (const entry of entries) {
    if (!entry || entry.month !== month) continue;
    chars = Math.max(chars, entry.chars);
  }
  return { month, chars };
};

const writeUsageToStores = (usage: TtsUsage): void => {
  if (!isBrowser()) return;
  const raw = JSON.stringify(usage);
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // 私密模式或容量滿時可能失敗，改寫入 sessionStorage
  }
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, raw);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(TTS_QUOTA_UPDATE_EVENT));
};

export const getTtsUsage = (): TtsUsage => {
  const month = currentMonthKey();
  if (!isBrowser()) return { month, chars: 0 };

  const fromLocal = readUsageFromStore((key) => window.localStorage.getItem(key));
  const fromSession = readUsageFromSessionStore();
  return mergeUsageForMonth(month, fromLocal, fromSession);
};

export const getTtsUsedChars = (): number => getTtsUsage().chars;

export const getRemainingTtsChars = (): number =>
  Math.max(0, TTS_MONTHLY_CHAR_LIMIT - getTtsUsage().chars);

export const canUseTtsChars = (chars: number): boolean =>
  chars > 0 && getRemainingTtsChars() >= chars;

export const recordTtsUsage = (chars: number): void => {
  if (chars <= 0 || !isBrowser()) return;
  const month = currentMonthKey();
  const usage = getTtsUsage();
  const used = usage.month === month ? usage.chars : 0;
  writeUsageToStores({ month, chars: used + chars });
};

export class TtsQuotaExceededError extends Error {
  constructor() {
    super(`本月 AI 朗讀已達 ${TTS_MONTHLY_CHAR_LIMIT.toLocaleString()} 字上限，請改用系統語音（免費）`);
    this.name = 'TtsQuotaExceededError';
  }
}
