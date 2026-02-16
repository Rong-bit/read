import express from 'express';
import cors from 'cors';
import { fetchNovelFromUrl } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API 健康檢查端點（用於前端檢測）
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 抓取小說內容端點
app.post('/api/fetch-novel', async (req, res) => {
  try {
    const { url, currentTitle } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: '缺少網址參數' });
    }

    console.log(`[${new Date().toISOString()}] 正在抓取小說: ${url}`);
    const result = await fetchNovelFromUrl(url, currentTitle);
    console.log(`[${new Date().toISOString()}] 抓取成功: 標題="${result.title}", 內容長度=${result.content.length}, 上一章=${result.prevChapterUrl || '無'}, 下一章=${result.nextChapterUrl || '無'}, 目錄章數=${result.chapters?.length || 0}`);
    
    res.json(result);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] 抓取失敗:`, error);
    const errorMessage = error.message || '抓取小說內容失敗，請檢查網址是否正確';
    console.error('錯誤詳情:', {
      message: errorMessage,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: errorMessage
    });
  }
});

app.listen(PORT, () => {
  console.log(`後端服務運行在 http://localhost:${PORT}`);
});
