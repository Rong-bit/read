
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  _sampleRate: number,
  _numChannels: number,
): Promise<AudioBuffer> {
  // ElevenLabs 路徑固定使用容器音訊（mp3/wav），僅走瀏覽器原生解碼，
  // 避免誤把壓縮音訊當 PCM 解析而產生整段雜音。
  try {
    const copy = data.slice().buffer; // 避免 byteOffset 造成解碼錯位
    return await ctx.decodeAudioData(copy);
  } catch (err: any) {
    throw new Error(err?.message || '無法解碼音訊資料');
  }
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
