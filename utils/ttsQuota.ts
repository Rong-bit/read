const STORAGE_KEY = 'google_tts_monthly_usage';

/** 每月 AI 朗讀字數上限（保守值，避免共用 API 金鑰超額） */
export const TTS_MONTHLY_CHAR_LIMIT = 200_000;

/** 單次請求建議上限（須與後端 GOOGLE_TTS_MAX_CHARS_PER_REQUEST 對齊） */
export const TTS_MAX_CHARS_PER_SEGMENT = 400;

const currentMonthKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export type TtsUsage = { month: string; chars: number };

export const getTtsUsage = (): TtsUsage => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const month = currentMonthKey();
    if (!raw) return { month, chars: 0 };
    const data = JSON.parse(raw) as TtsUsage;
    if (data.month !== month) return { month, chars: 0 };
    return { month, chars: Number(data.chars) || 0 };
  } catch {
    return { month: currentMonthKey(), chars: 0 };
  }
};

export const getRemainingTtsChars = (): number =>
  Math.max(0, TTS_MONTHLY_CHAR_LIMIT - getTtsUsage().chars);

export const canUseTtsChars = (chars: number): boolean =>
  chars > 0 && getRemainingTtsChars() >= chars;

export const recordTtsUsage = (chars: number): void => {
  if (chars <= 0) return;
  const month = currentMonthKey();
  const usage = getTtsUsage();
  const used = usage.month === month ? usage.chars : 0;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ month, chars: used + chars }));
};

export class TtsQuotaExceededError extends Error {
  constructor() {
    super(`本月 AI 朗讀已達 ${TTS_MONTHLY_CHAR_LIMIT.toLocaleString()} 字上限，請改用系統語音（免費）`);
    this.name = 'TtsQuotaExceededError';
  }
}
