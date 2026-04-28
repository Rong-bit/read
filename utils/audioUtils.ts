
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
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  // ElevenLabs 可能回傳 mp3/wav（依模型/帳號/端點協商），先嘗試辨識容器格式。
  const isRiff = data.byteLength >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x41 && data[10] === 0x56 && data[11] === 0x45;
  const isId3 = data.byteLength >= 3 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33;
  const isMpegFrame = data.byteLength >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
  if (isRiff || isId3 || isMpegFrame) {
    const copy = data.slice().buffer; // 避免 byteOffset 造成解碼錯位
    return await ctx.decodeAudioData(copy);
  }

  // Gemini TTS 回傳的是 16-bit LPCM (小端序)
  // 每個樣本佔 2 bytes，因此長度必須是 2 的倍數
  const bufferLength = Math.floor(data.byteLength / 2);
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, bufferLength);
  
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // 將 16-bit 整數縮放回 -1.0 到 1.0 的浮點數
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
