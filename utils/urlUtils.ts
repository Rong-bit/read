/**
 * 驗證是否為可安全開啟的 http(s) 網址，避免 Safari 顯示「網址無效」
 */
export function isValidHttpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 回傳可安全用於 iframe src / href / window.open 的網址，無效則回傳 null
 */
export function getSafeOpenUrl(url: string): string | null {
  if (!isValidHttpUrl(url)) return null;
  try {
    const u = new URL(url.trim());
    return u.href;
  } catch {
    return null;
  }
}
