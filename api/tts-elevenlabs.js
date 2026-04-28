const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
};

const parseElevenLabsError = (rawText) => {
  try {
    const payload = JSON.parse(rawText);
    const detail = payload?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    if (detail?.message) return String(detail.message);
    if (payload?.error) return String(payload.error);
    return rawText || 'ElevenLabs 回傳未知錯誤';
  } catch {
    return rawText || 'ElevenLabs 回傳未知錯誤';
  }
};

const firstBytesHex = (bytes, n = 8) =>
  Array.from(bytes.slice(0, n)).map((b) => b.toString(16).padStart(2, '0')).join(' ');

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

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || 'EXAVITQu4vr4xnSDxMaL';
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_v3';
  if (!apiKey) {
    res.status(500).json({ error: '伺服器缺少 ELEVENLABS_API_KEY' });
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
  const voiceId = typeof body.voiceId === 'string' && body.voiceId.trim() ? body.voiceId.trim() : defaultVoiceId;
  if (!text) {
    res.status(400).json({ error: '缺少 text' });
    return;
  }

  try {
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        // 固定用 mp3，避免不同環境對 raw PCM 解析差異造成雜音。
        output_format: 'mp3_44100_128',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75
        }
      })
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      const parsed = parseElevenLabsError(errText);
      res.status(ttsRes.status).json({ error: `ElevenLabs TTS 失敗：${parsed}` });
      return;
    }

    const audioBytes = new Uint8Array(await ttsRes.arrayBuffer());
    const upstreamContentType = ttsRes.headers.get('content-type') || '';
    const debugFirst8BytesHex = firstBytesHex(audioBytes, 8);
    res.status(200).json({
      audioBase64: toBase64(audioBytes),
      sampleRate: 44100,
      numChannels: 1,
      debug: {
        upstreamContentType,
        first8BytesHex: debugFirst8BytesHex
      }
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'ElevenLabs TTS 請求失敗' });
  }
}
