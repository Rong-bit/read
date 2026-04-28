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

const toAbsoluteUrl = (href, baseUrl) => {
  const raw = (href || '').trim();
  if (!raw || raw.startsWith('javascript:') || raw.startsWith('#')) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
};

const normalizeText = (text) => (text || '').replace(/\s+/g, ' ').trim();

const chapterTitleLike = (title) => /(第.{0,20}[章节回卷部集]|章|回|節)/i.test(title);

const extractNavigationAndChapters = ($, pageUrl) => {
  let nextChapterUrl;
  let prevChapterUrl;
  const chapters = [];
  const seen = new Set();

  const navRegex = {
    next: /(下一[章页]|下[一1]章|下一节|下一回|下一頁|next)/i,
    prev: /(上一[章页]|上[一1]章|上一节|上一回|上一頁|prev)/i,
    chapter: /(第.{0,15}[章节回卷部集]|章|回|節)/i
  };

  $('a[href]').each((_, el) => {
    const $a = $(el);
    const title = normalizeText($a.text());
    const href = toAbsoluteUrl($a.attr('href'), pageUrl);
    if (!href || !title) return;

    if (!prevChapterUrl && navRegex.prev.test(title)) prevChapterUrl = href;
    if (!nextChapterUrl && navRegex.next.test(title)) nextChapterUrl = href;

    if (!navRegex.chapter.test(title)) return;
    if (title.includes('目錄') || title.includes('返回') || title.includes('首页') || title.includes('首頁')) return;
    if (seen.has(href)) return;
    seen.add(href);
    chapters.push({ title: title.slice(0, 80), url: href });
  });

  return {
    prevChapterUrl,
    nextChapterUrl,
    chapters: chapters.slice(0, 500)
  };
};

const findCatalogUrl = ($, pageUrl) => {
  let catalogUrl = null;
  const catalogRegex = /(目录|目錄|全部章节|全部章節|章节列表|章節列表|list|catalog)/i;
  $('a[href]').each((_, el) => {
    if (catalogUrl) return;
    const $a = $(el);
    const title = normalizeText($a.text());
    const href = $a.attr('href') || '';
    if (!title && !href) return;
    if (!catalogRegex.test(title) && !catalogRegex.test(href)) return;
    const abs = toAbsoluteUrl(href, pageUrl);
    if (abs) catalogUrl = abs;
  });
  return catalogUrl;
};

const extractChapterListFromPage = ($, pageUrl) => {
  const chapters = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const title = normalizeText($a.text());
    if (!title || !chapterTitleLike(title)) return;
    const url = toAbsoluteUrl($a.attr('href'), pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    chapters.push({ title: title.slice(0, 80), url });
  });
  return chapters.slice(0, 2000);
};

const extractContent = ($, url) => {
  const urlLower = url.toLowerCase();
  const navigation = extractNavigationAndChapters($, url);

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
    if (content.length > 100) return { title, content, sourceUrl: url, ...navigation };
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
    if (content.length > 100) return { title, content, sourceUrl: url, ...navigation };
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
    if (content.length > 100) return { title, content, sourceUrl: url, ...navigation };
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
    if (content.length > 100) return { title, content, sourceUrl: url, ...navigation };
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
      if (content.length > 100) return { title, content, sourceUrl: url, ...navigation };
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
      if (content.length > 100) return { title, content, sourceUrl: url, ...navigation };
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
      if (content.length > 200) return { title, content, sourceUrl: url, ...navigation };
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
    if (content.length > 200) return { title, content, sourceUrl: url, ...navigation };
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

  // 部分站點的章節頁只提供上一章/下一章，需進目錄頁補抓完整章節清單。
  if (!result.chapters || result.chapters.length <= 2) {
    const catalogUrl = findCatalogUrl($, url);
    if (catalogUrl) {
      try {
        const tocResponse = await fetch(catalogUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
          }
        });
        if (tocResponse.ok) {
          const tocHtml = await tocResponse.text();
          const $toc = cheerio.load(tocHtml);
          const fullChapters = extractChapterListFromPage($toc, catalogUrl);
          if (fullChapters.length > (result.chapters?.length || 0)) {
            result.chapters = fullChapters;
          }
        }
      } catch {
        // 目錄補抓失敗不影響正文回傳
      }
    }
  }

  return result;
};

export default async function handler(req, res) {
  // CORS: allow GitHub Pages (and any static hosting) to call this endpoint.
  // Required because the browser sends an OPTIONS preflight before POST when Content-Type: application/json is used.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

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
    res.status(200).json({
      title,
      content: result.content,
      sourceUrl: url,
      nextChapterUrl: result.nextChapterUrl,
      prevChapterUrl: result.prevChapterUrl,
      chapters: result.chapters
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || '抓取失敗' });
  }
}
