import { GoogleGenAI, Modality, Type } from "@google/genai";
import { NovelContent } from "../types.ts";

const resolveApiKey = (): string => {
  const key = import.meta.env.VITE_API_KEY?.trim();
  if (!key) {
    throw new Error("缺少 API Key：請在前端環境變數設定 VITE_API_KEY");
  }
  return key;
};

const getAI = () => new GoogleGenAI({ apiKey: resolveApiKey() });

const getFetchNovelApiUrl = (): string | null => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const fallbackGithubApiBase = 'https://read-kappa-two.vercel.app';
  // 未設定時保持本地開發行為：走同源 /api/fetch-novel
  if (!baseUrl) {
    // GitHub Pages 是靜態託管，沒有後端 /api 可用
    if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) {
      return `${fallbackGithubApiBase}/api/fetch-novel`;
    }
    return '/api/fetch-novel';
  }
  return `${baseUrl.replace(/\/+$/, '')}/api/fetch-novel`;
};

const isLikelyUrlInput = (value: string): boolean => {
  const raw = value.trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/\s/.test(raw)) return false;
  if (!raw.includes('.')) return false;
  try {
    const withScheme = `https://${raw}`;
    const u = new URL(withScheme);
    return Boolean(u.hostname && u.hostname.includes('.'));
  } catch {
    return false;
  }
};

const fetchNovelByKeyword = async (keyword: string): Promise<NovelContent> => {
  const ai = getAI();
  const prompt = `請搜尋小說「${keyword}」，回傳可直接閱讀的章節全文。
要求：
1) 嚴禁摘要，盡量提供完整章節正文。
2) 若可取得，提供上一章、下一章連結與章節目錄（至少數筆）。
3) 只輸出 JSON。`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
          sourceUrl: { type: Type.STRING },
          nextChapterUrl: { type: Type.STRING },
          prevChapterUrl: { type: Type.STRING },
          chapters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                url: { type: Type.STRING }
              }
            }
          }
        },
        required: ["title", "content"]
      }
    }
  });

  const raw = response.text?.trim();
  if (!raw) {
    throw new Error('關鍵字搜尋未取得內容，請改用完整章節網址。');
  }
  const data = JSON.parse(raw);
  const content = (data.content || '').trim();
  if (!content) {
    throw new Error('關鍵字搜尋未取得章節正文，請改用完整章節網址。');
  }
  return {
    title: data.title || keyword,
    content,
    sourceUrl: data.sourceUrl,
    nextChapterUrl: data.nextChapterUrl,
    prevChapterUrl: data.prevChapterUrl,
    chapters: Array.isArray(data.chapters) ? data.chapters : [],
    groundingSources: response.candidates?.[0]?.groundingMetadata?.groundingChunks
  };
};

// 驗證 URL 並嘗試從後端取得正文（若後端可用）
export const fetchNovelContent = async (input: string, currentTitle?: string): Promise<NovelContent> => {
  try {
    const originalInput = input.trim();
    if (!originalInput) throw new Error('請輸入書名或網址');
    if (!isLikelyUrlInput(originalInput)) {
      return await fetchNovelByKeyword(originalInput);
    }

    let url = originalInput;
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
    console.log('開始抓取小說，URL:', url);
    try {
      const apiUrl = getFetchNovelApiUrl();
      if (!apiUrl) {
        throw new Error('目前為 GitHub Pages 靜態部署，請設定 VITE_API_BASE_URL 指向可用後端 API。');
      }
      console.log('發送請求到', apiUrl);
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, currentTitle: title })
      });
      console.log('收到響應，狀態:', res.status, res.statusText);
      if (res.ok) {
        const data = await res.json();
        console.log('後端返回數據:', { 
          title: data.title, 
          contentLength: data.content?.length, 
          nextChapterUrl: data.nextChapterUrl 
        });
        if (data.content && data.content.length > 0) {
          return {
            title: data.title || title,
            content: data.content,
            sourceUrl: url,
            nextChapterUrl: data.nextChapterUrl,
            prevChapterUrl: data.prevChapterUrl,
            chapters: data.chapters,
            groundingSources: undefined
          };
        }
        // 即使沒有內容，也返回 nextChapterUrl 或 prevChapterUrl（如果有）
        if (data.nextChapterUrl || data.prevChapterUrl || data.chapters) {
          return {
            title: data.title || title,
            content: '',
            sourceUrl: url,
            nextChapterUrl: data.nextChapterUrl,
            prevChapterUrl: data.prevChapterUrl,
            chapters: data.chapters,
            groundingSources: undefined
          };
        }
      } else {
        const errorText = await res.text();
        console.error('後端返回錯誤:', res.status, errorText);
      }
    } catch (error) {
      // 後端不可用（例如 Vercel 僅前端），繼續使用空 content
      console.error('呼叫後端失敗:', error);
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

// Fix: Removed manual apiKey parameter as process.env.API_KEY must be used exclusively
export const generateSpeech = async (
  text: string,
  voiceName: string = 'Kore'
): Promise<string> => {
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
