
import { GoogleGenAI, Modality } from "@google/genai";
import { NovelContent } from "../types";

const getAI = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY || "";
  return new GoogleGenAI({ apiKey });
};

// 不再抓取內容，只驗證和保存 URL
export const fetchNovelContent = async (input: string, currentTitle?: string): Promise<NovelContent> => {
  try {
    // 驗證 URL 格式
    let url = input.trim();
    
    // 如果不是完整的 URL，嘗試添加 https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // 驗證 URL 格式
    try {
      new URL(url);
    } catch {
      throw new Error('無效的網址格式');
    }
    
    // 從 URL 提取標題（如果沒有提供）
    const title = currentTitle || extractTitleFromUrl(url) || '小說閱讀';
    
    return {
      title,
      content: '', // 不再抓取內容
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
    } else if (hostname.includes('zongheng.com')) {
      return '縱橫中文網';
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
