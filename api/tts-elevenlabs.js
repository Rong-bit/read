const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
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

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || 'EXAVITQu4vr4xnSDxMaL';
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
        'Accept': 'audio/pcm'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        output_format: 'pcm_24000',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75
        }
      })
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      res.status(ttsRes.status).json({ error: errText || 'ElevenLabs TTS 失敗' });
      return;
    }

    const audioBytes = new Uint8Array(await ttsRes.arrayBuffer());
    res.status(200).json({
      audioBase64: toBase64(audioBytes),
      sampleRate: 24000,
      numChannels: 1
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'ElevenLabs TTS 請求失敗' });
  }
}
