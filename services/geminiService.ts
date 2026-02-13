
import { GoogleGenAI, Modality } from "@google/genai";
import { NovelContent } from "../types.ts";

const getAI = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || "";
  return new GoogleGenAI({ apiKey });
};

// 驗證 URL 並嘗試從後端取得正文（若後端可用）
export const fetchNovelContent = async (input: string, currentTitle?: string): Promise<NovelContent> => {
  try {
    let url = input.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      new URL(url);
    } catch {
      throw new Error('無效的網址格式');
    }
    const title = currentTitle || extractTitleFromUrl(url) || '小說閱讀';

    // 嘗試呼叫後端抓取正文（本機 npm run dev:all 時有效）
    try {
      const res = await fetch('/api/fetch-novel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, currentTitle: title })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.content && data.content.length > 0) {
          return {
            title: data.title || title,
            content: data.content,
            sourceUrl: url,
            groundingSources: undefined
          };
        }
      }
    } catch (_) {
      // 後端不可用（例如 Vercel 僅前端），繼續使用空 content
    }

    return {
      title,
      content: '',
      sourceUrl: url,
      groundingSources: undefined
    };
  } catch (error: any) {
    console.error('處理網址失敗:', error);
    throw new Error(error.message || '無法處理網址，請檢查網址是否正確');
  }
};

// 從 URL 提取可能的標題
const extractTitleFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // 從常見的小說網站提取書名
    if (hostname.includes('fanqienovel.com')) {
      return '番茄小說';
    } else if (hostname.includes('qidian.com')) {
      return '起點中文網';
    } else if (hostname.includes('jjwxc.net')) {
      return '晉江文學城';
    } else     if (hostname.includes('zongheng.com')) {
      return '縱橫中文網';
    }
    if (hostname.includes('hjwzw.com')) {
      return '黃金屋';
    }
    return '小說閱讀';
  } catch {
    return '小說閱讀';
  }
};

export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string> => {
  const ai = getAI();
  
  // 長篇朗讀優化
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `請朗讀以下小說正文，保持適當的語速與停頓：\n\n${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!base64Audio) throw new Error("語音合成失敗");
  return base64Audio;
};
