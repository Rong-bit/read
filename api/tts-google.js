import crypto from 'crypto';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
};

const base64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const parseGoogleError = (rawText) => {
  try {
    const payload = JSON.parse(rawText);
    const message = payload?.error?.message;
    if (message) return String(message);
    return rawText || 'Google Cloud TTS 回傳未知錯誤';
  } catch {
    return rawText || 'Google Cloud TTS 回傳未知錯誤';
  }
};

const envInt = (key, fallback) => {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** 僅允許 Standard 語音（免費額度最高、單價最低） */
const MAX_CHARS_PER_REQUEST = envInt('GOOGLE_TTS_MAX_CHARS_PER_REQUEST', 400);
const MAX_REQUESTS_PER_MINUTE = envInt('GOOGLE_TTS_MAX_REQUESTS_PER_MINUTE', 30);
const rateLimitMap = new Map();

const isTtsDisabled = () => {
  const v = process.env.GOOGLE_TTS_DISABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
};

const checkRateLimit = (ip) => {
  const now = Date.now();
  const windowMs = 60_000;
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  rateLimitMap.set(ip, entry);
  if (rateLimitMap.size > 500) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }
  return entry.count <= MAX_REQUESTS_PER_MINUTE;
};

const getServiceAccountCredentials = () => {
  const raw = process.env.GOOGLE_CLOUD_TTS_CREDENTIALS?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_CLOUD_TTS_CREDENTIALS 不是有效的 JSON');
  }
};

const getAccessTokenFromServiceAccount = async (credentials) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const signInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signInput);
  const signature = base64url(sign.sign(credentials.private_key));
  const jwt = `${signInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || '無法取得 Google 存取權杖');
  }
  return tokenData.access_token;
};

/** 強制對應到 Standard 語音，拒絕 Wavenet / Neural2（較貴） */
const resolveVoice = (voiceName) => {
  const languageCode = process.env.GOOGLE_CLOUD_TTS_LANGUAGE?.trim() || 'cmn-TW';
  const defaultVoice = `${languageCode}-Standard-A`;
  const raw = (voiceName || '').trim();

  const toStandard = (name) => {
    if (!name.includes('-Standard-')) {
      return name
        .replace(/-Wavenet-[A-Z]/gi, (m) => `-Standard-${m.slice(-1)}`)
        .replace(/-Neural2-[A-Z]/gi, (m) => `-Standard-${m.slice(-1)}`);
    }
    return name;
  };

  if (raw.includes('-Standard-')) {
    const lang = raw.split('-').slice(0, 2).join('-');
    return { languageCode: lang || languageCode, name: raw };
  }

  const alias = raw.toLowerCase();
  const aliasMap = {
    aoede: `${languageCode}-Standard-A`,
    kore: `${languageCode}-Standard-B`,
    puck: `${languageCode}-Standard-C`,
    charon: `${languageCode}-Standard-B`,
    fenrir: `${languageCode}-Standard-C`,
  };

  let resolvedName = aliasMap[alias] || defaultVoice;
  if (raw.includes('-Wavenet-') || raw.includes('-Neural2-')) {
    resolvedName = toStandard(raw);
  }
  if (!resolvedName.includes('-Standard-')) {
    resolvedName = defaultVoice;
  }

  const lang = resolvedName.split('-').slice(0, 2).join('-');
  return { languageCode: lang || languageCode, name: resolvedName };
};

export const synthesizeGoogleSpeech = async (text, voiceName) => {
  if (isTtsDisabled()) {
    throw new Error('伺服器已關閉 AI 朗讀（GOOGLE_TTS_DISABLED）');
  }

  const trimmed = (text || '').trim();
  if (!trimmed) {
    throw new Error('缺少 text');
  }
  if (trimmed.length > MAX_CHARS_PER_REQUEST) {
    throw new Error(`單次朗讀不得超過 ${MAX_CHARS_PER_REQUEST} 字（請縮短段落）`);
  }

  const apiKey = process.env.GOOGLE_CLOUD_API_KEY?.trim();
  const credentials = getServiceAccountCredentials();
  if (!apiKey && !credentials) {
    throw new Error('伺服器缺少 GOOGLE_CLOUD_API_KEY 或 GOOGLE_CLOUD_TTS_CREDENTIALS');
  }

  const accessToken = credentials ? await getAccessTokenFromServiceAccount(credentials) : null;
  const endpoint = accessToken
    ? 'https://texttospeech.googleapis.com/v1/text:synthesize'
    : `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;

  const { languageCode, name } = resolveVoice(voiceName);
  const speakingRate = Number(process.env.GOOGLE_CLOUD_TTS_SPEAKING_RATE || '1.0');
  const pitch = Number(process.env.GOOGLE_CLOUD_TTS_PITCH || '0');

  const ttsRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      input: { text: trimmed },
      voice: { languageCode, name },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Number.isFinite(speakingRate) ? speakingRate : 1.0,
        pitch: Number.isFinite(pitch) ? pitch : 0,
      },
    }),
  });

  if (!ttsRes.ok) {
    const errText = await ttsRes.text();
    throw new Error(`Google Cloud TTS 失敗：${parseGoogleError(errText)}`);
  }

  const data = await ttsRes.json();
  if (!data.audioContent) {
    throw new Error('Google Cloud TTS 未回傳音訊');
  }
  return data.audioContent;
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (isTtsDisabled()) {
    res.status(503).json({ error: 'AI 朗讀已關閉', code: 'TTS_DISABLED' });
    return;
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    res.status(429).json({
      error: `請求過於頻繁，每分鐘最多 ${MAX_REQUESTS_PER_MINUTE} 次`,
      code: 'RATE_LIMIT',
    });
    return;
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const voiceName = typeof body.voiceName === 'string' ? body.voiceName.trim() : '';
  if (!text) {
    res.status(400).json({ error: '缺少 text' });
    return;
  }
  if (text.length > MAX_CHARS_PER_REQUEST) {
    res.status(400).json({
      error: `單次不得超過 ${MAX_CHARS_PER_REQUEST} 字`,
      code: 'TEXT_TOO_LONG',
      maxChars: MAX_CHARS_PER_REQUEST,
    });
    return;
  }

  try {
    const audioBase64 = await synthesizeGoogleSpeech(text, voiceName);
    const { name } = resolveVoice(voiceName);
    res.status(200).json({
      audioBase64,
      sampleRate: 24000,
      numChannels: 1,
      tier: 'standard',
      voiceUsed: name,
      charCount: text.length,
      maxCharsPerRequest: MAX_CHARS_PER_REQUEST,
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Google Cloud TTS 請求失敗' });
  }
}
