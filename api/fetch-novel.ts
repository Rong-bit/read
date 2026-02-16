// 在 Vercel 的 Serverless Function 中，建議不要用 `.js` 副檔名去 import `.ts` 檔，
// 否則打包後可能找不到對應模組而導致整個 API 直接 500。
import { fetchNovelFromUrl } from './_lib/scraper';

// 明確指定使用 Node.js runtime（需要使用 cheerio / puppeteer-core 等 Node 能力）
export const config = {
  runtime: 'nodejs',
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { url, currentTitle } = req.body || {};
    if (!url) {
      res.status(400).json({ error: '缺少網址參數' });
      return;
    }

    const result = await fetchNovelFromUrl(url, currentTitle);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({
      error: error.message || '抓取小說內容失敗，請檢查網址是否正確'
    });
  }
}
