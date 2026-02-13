import { fetchNovelFromUrl } from './_lib/scraper';

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
