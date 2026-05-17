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

const resolveVoice = (voiceName) => {
  const languageCode = process.env.GOOGLE_CLOUD_TTS_LANGUAGE?.trim() || 'cmn-TW';
  const defaultVoice = process.env.GOOGLE_CLOUD_TTS_VOICE?.trim() || `${languageCode}-Wavenet-B`;
  const raw = (voiceName || '').trim();
  if (!raw) return { languageCode, name: defaultVoice };

  if (raw.includes('-Wavenet-') || raw.includes('-Neural2-') || raw.includes('-Standard-')) {
    const lang = raw.split('-').slice(0, 2).join('-');
    return { languageCode: lang || languageCode, name: raw };
  }

  const alias = raw.toLowerCase();
  const aliasMap = {
    kore: `${languageCode}-Wavenet-B`,
    puck: `${languageCode}-Wavenet-C`,
    charon: `${languageCode}-Neural2-C`,
    fenrir: `${languageCode}-Neural2-B`,
    aoede: `${languageCode}-Wavenet-A`,
  };
  const resolvedName = aliasMap[alias] || defaultVoice;
  const lang = resolvedName.split('-').slice(0, 2).join('-');
  return { languageCode: lang || languageCode, name: resolvedName };
};

export const synthesizeGoogleSpeech = async (text, voiceName) => {
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
      input: { text },
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

  try {
    const audioBase64 = await synthesizeGoogleSpeech(text, voiceName);
    res.status(200).json({
      audioBase64,
      sampleRate: 24000,
      numChannels: 1,
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Google Cloud TTS 請求失敗' });
  }
}
