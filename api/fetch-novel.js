import * as cheerio from 'cheerio';

const normalizeUrl = (input) => {
  let url = input.trim();
  if (!url) return null;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
};

const extractContent = ($, url) => {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('fanqienovel.com') || urlLower.includes('fanqie')) {
    const title = $('h1.chapter-title, .chapter-title, h1').first().text().trim() ||
                  $('title').text().trim();
    const content = $('.chapter-content, .content, #chaptercontent, .chapter-body')
      .first()
      .find('p, div')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text.length > 0)
      .join('\n\n');
    if (content.length > 100) return { title, content, sourceUrl: url };
  }

  if (urlLower.includes('qidian.com')) {
    const title = $('h1.chapter-title, .chapter-title, h1').first().text().trim() ||
                  $('title').text().trim();
    const content = $('.chapter-content, .content, .read-content, .chapter-body')
      .first()
      .find('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text.length > 0)
      .join('\n\n');
    if (content.length > 100) return { title, content, sourceUrl: url };
  }

  if (urlLower.includes('jjwxc.net') || urlLower.includes('jjwxc')) {
    const title = $('h1, .novel-title, .chapter-title').first().text().trim() ||
                  $('title').text().trim();
    const content = $('.noveltext, .content, #noveltext, .chapter-content')
      .first()
      .find('p, div')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text.length > 0 && !text.includes('晉江'))
      .join('\n\n');
    if (content.length > 100) return { title, content, sourceUrl: url };
  }

  if (urlLower.includes('zongheng.com')) {
    const title = $('h1, .chapter-title').first().text().trim() ||
                  $('title').text().trim();
    const content = $('.content, .chapter-content, .read-content')
      .first()
      .find('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text.length > 0)
      .join('\n\n');
    if (content.length > 100) return { title, content, sourceUrl: url };
  }

  if (urlLower.includes('hjwzw.com')) {
    const $main = $('div[style*="750px"]').first();
    if ($main.length > 0) {
      const title = $('h1, .chapter-title, .title').first().text().trim() || $('title').text().trim();
      const content = $main
        .find('p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(t => t.length > 5 && !t.includes('請記住本站域名'))
        .join('\n\n');
      if (content.length > 100) return { title, content, sourceUrl: url };
    }
  }

  if (urlLower.includes('twword.com')) {
    const title = $('.chapter-content h1').first().text().trim() ||
                  $('h1').first().text().trim() ||
                  $('title').text().trim();
    const $content = $('.chapter-content .content').first();
    if ($content.length > 0) {
      $content.find('.gadBlock, .adBlock, ins, script, iframe, ad').remove();
      const content = $content
        .find('p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => text.length > 0 && !text.includes('溫馨提示'))
        .join('\n\n');
      if (content.length > 100) return { title, content, sourceUrl: url };
    }
  }

  const commonSelectors = [
    '.chapter-content',
    '.content',
    '#chaptercontent',
    '.chapter-body',
    '.read-content',
    'article',
    '.noveltext',
    '#noveltext',
    '.text-content'
  ];
  for (const selector of commonSelectors) {
    const $content = $(selector).first();
    if ($content.length > 0) {
      const title = $('h1, .chapter-title, .title').first().text().trim() ||
                    $('title').text().trim();
      const content = $content
        .find('p, div')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => {
          const textLower = text.toLowerCase();
          return text.length > 10 &&
                 !textLower.includes('copyright') &&
                 !textLower.includes('版權') &&
                 !textLower.includes('本章完') &&
                 !textLower.includes('下一章');
        })
        .join('\n\n');
      if (content.length > 200) return { title, content, sourceUrl: url };
    }
  }

  const title = $('h1, .chapter-title, .title').first().text().trim() ||
                $('title').text().trim();
  const paragraphs = $('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(text => {
      const textLower = text.toLowerCase();
      return text.length > 20 &&
             !textLower.includes('copyright') &&
             !textLower.includes('版權') &&
             !textLower.includes('廣告') &&
             !textLower.includes('advertisement');
    });

  if (paragraphs.length > 3) {
    const content = paragraphs.join('\n\n');
    if (content.length > 200) return { title, content, sourceUrl: url };
  }

  return null;
};

const fetchWithCheerio = async (url) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP 錯誤: ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);
  const result = extractContent($, url);
  if (!result || result.content.length < 200) {
    throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${result?.content.length || 0} 字）`);
  }
  return result;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const url = normalizeUrl(body.url || '');
  const titleOverride = typeof body.currentTitle === 'string' ? body.currentTitle : '';

  if (!url) {
    res.status(400).json({ error: '缺少或無效的網址參數' });
    return;
  }

  try {
    const result = await fetchWithCheerio(url);
    const title = result.title || titleOverride || '小說閱讀';
    res.status(200).json({ title, content: result.content, sourceUrl: url });
  } catch (error) {
    res.status(500).json({ error: error?.message || '抓取失敗' });
  }
}
