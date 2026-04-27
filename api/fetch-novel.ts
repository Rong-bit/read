import { fetchNovelFromUrl } from './_lib/scraper.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const payload = req.method === 'GET'
      ? req.query || {}
      : (req.body || {});
    const { url, currentTitle } = payload;
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
