import * as cheerio from 'cheerio';

export interface NovelResult {
  title: string;
  content: string;
  sourceUrl?: string;
  nextChapterUrl?: string;
}

const needsPuppeteer = (url: string): boolean => {
  const urlLower = url.toLowerCase();
  return urlLower.includes('qidian.com') || urlLower.includes('webnovel.com');
};

// 提取下一章链接
const extractNextChapterUrl = ($: cheerio.CheerioAPI, url: string): string | undefined => {
  const urlLower = url.toLowerCase();
  let baseUrl: string;
  try {
    baseUrl = new URL(url).origin;
  } catch {
    return undefined;
  }
  
  // 稷下書院 / twword.com - 从脚本变量中提取
  if (urlLower.includes('twword.com')) {
    // 尝试从 JavaScript 变量中提取
    const scriptText = $('script').toArray().map(el => $(el).html() || '').join(' ');
    const nextUrlMatch = scriptText.match(/var\s+nextUrl\s*=\s*['"]([^'"]+)['"]/);
    if (nextUrlMatch && nextUrlMatch[1]) {
      const nextUrl = nextUrlMatch[1];
      console.log('從腳本變量提取到下一章:', nextUrl);
      if (nextUrl.startsWith('http')) return nextUrl;
      if (nextUrl.startsWith('/')) return baseUrl + nextUrl;
      try {
        return new URL(nextUrl, url).href;
      } catch {
        return baseUrl + nextUrl;
      }
    }
    
    // 从底部导航中提取
    const footNavLinks = $('.foot-nav a').toArray();
    for (const link of footNavLinks) {
      const $link = $(link);
      const text = $link.text().trim();
      if (text.includes('下一章') || text.includes('下一頁')) {
        const href = $link.attr('href');
        if (href) {
          console.log('從底部導航提取到下一章:', href);
          if (href.startsWith('http')) return href;
          if (href.startsWith('/')) return baseUrl + href;
          try {
            return new URL(href, url).href;
          } catch {
            return baseUrl + href;
          }
        }
      }
    }
    
    // 从 nextBtn 类中提取
    const nextBtnLink = $('.nextBtn').parent('a').attr('href') || 
                       $('a.nextBtn').attr('href') ||
                       $('[class*="next"]').filter((_, el) => {
                         const text = $(el).text().toLowerCase();
                         return text.includes('下一章') || text.includes('下一頁');
                       }).attr('href');
    if (nextBtnLink) {
      if (nextBtnLink.startsWith('http')) return nextBtnLink;
      if (nextBtnLink.startsWith('/')) return baseUrl + nextBtnLink;
      return new URL(nextBtnLink, url).href;
    }
  }
  
  // 通用提取：查找包含"下一章"、"下一頁"、"Next"等文字的链接
  const allLinks = $('a').toArray();
  for (const link of allLinks) {
    const $link = $(link);
    const text = $link.text().trim().toLowerCase();
    const href = $link.attr('href');
    if (href && (text.includes('下一章') || text.includes('下一頁') || text.includes('下一页'))) {
      console.log('從通用鏈接提取到下一章:', href);
      if (href.startsWith('http')) return href;
      if (href.startsWith('/')) return baseUrl + href;
      try {
        return new URL(href, url).href;
      } catch {
        return baseUrl + href;
      }
    }
  }
  
  console.log('未找到下一章鏈接');
  return undefined;
};

const extractContent = ($: cheerio.CheerioAPI, url: string): NovelResult | null => {
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
    if (content.length > 100) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl };
    }
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
    if (content.length > 100) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl };
    }
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
    if (content.length > 100) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl };
    }
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
    if (content.length > 100) {
      return { title, content, sourceUrl: url };
    }
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
      if (content.length > 100) {
        const nextChapterUrl = extractNextChapterUrl($, url);
        return { title, content, sourceUrl: url, nextChapterUrl };
      }
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
      if (content.length > 100) {
        const nextChapterUrl = extractNextChapterUrl($, url);
        return { title, content, sourceUrl: url, nextChapterUrl };
      }
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
      if (content.length > 200) {
        const nextChapterUrl = extractNextChapterUrl($, url);
        return { title, content, sourceUrl: url, nextChapterUrl };
      }
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
    if (content.length > 200) {
      const nextChapterUrl = extractNextChapterUrl($, url);
      return { title, content, sourceUrl: url, nextChapterUrl };
    }
  }

  return null;
};

const fetchWithPuppeteer = async (url: string): Promise<NovelResult> => {
  const chromium = (await import('@sparticuz/chromium')).default as any;
  const puppeteer = (await import('puppeteer-core')).default as any;

  let browser: any = null;
  try {
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath || undefined,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await page.waitForTimeout(2000);

    const html = await page.content();
    const $ = cheerio.load(html);

    const result = extractContent($, url);
    if (result && result.content.length >= 200) {
      return result;
    }

    throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${result?.content.length || 0} 字，可能是摘要或抓取失敗）`);
  } catch (error: any) {
    throw new Error(`Puppeteer 啟動或抓取失敗：${error?.message || '未知錯誤'}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const fetchWithCheerio = async (url: string): Promise<NovelResult> => {
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
    throw new Error(`無法從網頁中提取足夠的小說內容（僅提取到 ${result?.content.length || 0} 字，可能是摘要或抓取失敗）`);
  }
  return result;
};

export const fetchNovelFromUrl = async (url: string, currentTitle?: string): Promise<NovelResult> => {
  try {
    if (!needsPuppeteer(url)) {
      try {
        return await fetchWithCheerio(url);
      } catch (error) {
        console.log('Cheerio 抓取失敗，嘗試使用 Puppeteer:', error);
      }
    }
    return await fetchWithPuppeteer(url);
  } catch (error: any) {
    throw new Error(`抓取失敗: ${error.message}`);
  }
};
