import express from 'express';
import cors from 'cors';
import { fetchNovelFromUrl } from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 抓取小說內容端點
app.post('/api/fetch-novel', async (req, res) => {
  try {
    const { url, currentTitle } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: '缺少網址參數' });
    }

    console.log(`正在抓取小說: ${url}`);
    const result = await fetchNovelFromUrl(url, currentTitle);
    
    res.json(result);
  } catch (error: any) {
    console.error('抓取失敗:', error);
    res.status(500).json({ 
      error: error.message || '抓取小說內容失敗，請檢查網址是否正確' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`後端服務運行在 http://localhost:${PORT}`);
});
